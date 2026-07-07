// Cuteness Overload — three.js renderer.
//
// Public API (the surface the UI codes against):
//   constructor(canvas)
//   setMap(map)                              build terrain / path / home
//   render(state, dt, events?)               draw a frame; `events` overrides
//                                            state.events (the UI may run 1-2
//                                            sim steps per frame and pass the
//                                            concatenated SimEvent[]).
//   pickHex(clientX, clientY): {q,r} | null
//   setHover(hex, valid)
//   showRange(x, z, range) / hideRange()
//   resize()
//   dispose()
//
// No shadows, everything instanced/merged, pixelRatio capped, hot paths reuse
// scratch objects — tuned for 60fps on mid phones.

import * as THREE from 'three';
import type {
  MapDef, GameState, SimEvent, EnemyKind, TowerKind, Tower, Terrain,
} from '../sim/types';
import { HEX_SIZE } from '../sim/constants';
import { hexToWorld } from '../sim/hex';
import * as C from './theme';
import { makeFaceTexture } from './textures';
import { Effects } from './effects';

const SQRT3 = Math.sqrt(3);
const HEX_H = 0.5; // prism height; top surface sits at y = 0
const ENEMY_CAP = 256; // max instances per enemy kind
const HOVER_VALID = 0x6bff8f;
const HOVER_INVALID = 0xff6b6b;

interface EnemyMesh {
  mesh: THREE.InstancedMesh;
  y: number; // resting height above ground
  radius: number; // base scale used for wobble
}

interface HpBar {
  group: THREE.Group;
  fill: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private effects: Effects;

  private map: MapDef | null = null;

  // Terrain.
  private terrain: THREE.InstancedMesh | null = null;
  private terrainMat: THREE.MeshLambertMaterial;
  private terrainGeo: THREE.CylinderGeometry;
  private cellIndex = new Map<string, number>(); // "q,r" -> instance index
  private cellExists = new Set<string>();
  private baseColors: THREE.Color[] = []; // per-instance terrain color
  private decor = new THREE.Group();

  // Enemies.
  private enemyMeshes: Record<EnemyKind, EnemyMesh>;
  private faceTextures: THREE.CanvasTexture[] = [];
  private shieldBubble: THREE.InstancedMesh;
  private hpBars: HpBar[] = [];

  // Towers (rebuilt on change, keyed by a levels hash).
  private towerGroup = new THREE.Group();
  private towerObjs = new Map<number, { group: THREE.Group; pulse: THREE.Object3D[] }>();
  private towerHash = '';

  // Hover + range.
  private hoverIndex = -1;
  private rangeDisc: THREE.Mesh;

  // Camera framing.
  private target = new THREE.Vector3();
  private frameRadius = 10;
  private readonly elevation = (52 * Math.PI) / 180;

  // Picking.
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Scratch (no per-frame allocation).
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpVec2 = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();
  private enemyPosById = new Map<number, { x: number; z: number }>();
  private towerPosById = new Map<number, { x: number; z: number }>();
  private homeWorld = { x: 0, z: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: (window.devicePixelRatio || 1) <= 1.5,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(C.SKY, 1);

    this.scene.background = new THREE.Color(C.SKY);
    this.scene.fog = new THREE.Fog(C.FOG, 20, 60);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const sun = new THREE.DirectionalLight(0xfff6e6, 1.15);
    sun.position.set(6, 12, 4);
    this.scene.add(ambient, sun);

    this.scene.add(this.decor);
    this.scene.add(this.towerGroup);

    this.effects = new Effects(this.scene);

    // Terrain resources (mesh built per-map in setMap).
    this.terrainGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.96, HEX_SIZE * 0.94, HEX_H, 6);
    this.terrainGeo.rotateY(Math.PI / 6); // flat-top: vertices point along ±x
    this.terrainMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Enemy meshes, one InstancedMesh per kind with a baked cute face.
    this.enemyMeshes = {
      regular: this.buildEnemyMesh('regular', new THREE.BoxGeometry(0.55, 0.55, 0.55), 0.32, 0.55),
      fast: this.buildEnemyMesh('fast', new THREE.TetrahedronGeometry(0.42), 0.30, 0.42),
      shield: this.buildEnemyMesh('shield', new THREE.OctahedronGeometry(0.44), 0.42, 0.44),
      boss: this.buildEnemyMesh('boss', new THREE.IcosahedronGeometry(0.8), 0.75, 0.8),
    };

    // Translucent shield bubbles (shared instanced sphere).
    const bubbleGeo = new THREE.SphereGeometry(0.62, 12, 10);
    const bubbleMat = new THREE.MeshLambertMaterial({
      color: C.SHIELD_BUBBLE, transparent: true, opacity: 0.32, depthWrite: false,
    });
    this.shieldBubble = new THREE.InstancedMesh(bubbleGeo, bubbleMat, ENEMY_CAP);
    this.shieldBubble.count = 0;
    this.shieldBubble.frustumCulled = false;
    this.scene.add(this.shieldBubble);

    // Boss hp bars (small billboard pool).
    for (let i = 0; i < 4; i++) this.hpBars.push(this.buildHpBar());

    // Placement range disc.
    const discGeo = new THREE.CircleGeometry(1, 40);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x8fe0ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rangeDisc = new THREE.Mesh(discGeo, discMat);
    this.rangeDisc.visible = false;
    this.rangeDisc.position.y = 0.05;
    this.scene.add(this.rangeDisc);

    this.resize();
  }

  // ---- construction helpers -------------------------------------------------

  private buildEnemyMesh(kind: EnemyKind, geo: THREE.BufferGeometry, y: number, radius: number): EnemyMesh {
    const tex = makeFaceTexture(C.ENEMY_COLOR[kind]);
    this.faceTextures.push(tex);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.InstancedMesh(geo, mat, ENEMY_CAP);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, y, radius };
  }

  private buildHpBar(): HpBar {
    const group = new THREE.Group();
    const bgGeo = new THREE.PlaneGeometry(1.25, 0.16);
    const bg = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ color: 0x33323a, depthTest: false, transparent: true }));
    bg.renderOrder = 998;
    const fillGeo = new THREE.PlaneGeometry(1.2, 0.11);
    fillGeo.translate(0.6, 0, 0.001); // pivot at left edge so scale.x grows rightward
    const mat = new THREE.MeshBasicMaterial({ color: 0x7be08a, depthTest: false, transparent: true });
    const fill = new THREE.Mesh(fillGeo, mat);
    fill.position.x = -0.6;
    fill.renderOrder = 999;
    group.add(bg, fill);
    group.visible = false;
    this.scene.add(group);
    return { group, fill, mat };
  }

  // ---- map -----------------------------------------------------------------

  setMap(map: MapDef): void {
    this.map = map;
    this.clearTerrain();
    this.clearTowers();

    const n = map.cells.length;
    this.terrain = new THREE.InstancedMesh(this.terrainGeo, this.terrainMat, n);
    this.terrain.frustumCulled = false;
    this.baseColors = [];
    this.cellIndex.clear();
    this.cellExists.clear();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    map.cells.forEach((cell, i) => {
      const { x, z } = hexToWorld(cell.q, cell.r);
      this.dummy.position.set(x, -HEX_H / 2, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.terrain!.setMatrixAt(i, this.dummy.matrix);

      const col = this.jitterColor(cell.t);
      this.baseColors.push(col.clone());
      this.terrain!.setColorAt(i, col);

      const key = cell.q + ',' + cell.r;
      this.cellIndex.set(key, i);
      this.cellExists.add(key);

      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

      if (cell.t === 'home') this.homeWorld = { x, z };
      this.addDecoration(cell.t, x, z);
    });

    this.terrain.instanceMatrix.needsUpdate = true;
    if (this.terrain.instanceColor) this.terrain.instanceColor.needsUpdate = true;
    this.scene.add(this.terrain);

    // Camera framing from map bounds.
    this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.frameRadius = 0.5 * Math.hypot(maxX - minX, maxZ - minZ) + HEX_SIZE * 1.5;
    this.frameCamera();

    this.hoverIndex = -1;
    this.towerHash = '';
  }

  private jitterColor(t: Terrain): THREE.Color {
    const c = this.tmpColor.setHex(C.TERRAIN[t]);
    const j = (Math.random() - 0.5) * 0.08;
    return new THREE.Color(
      THREE.MathUtils.clamp(c.r + j, 0, 1),
      THREE.MathUtils.clamp(c.g + j, 0, 1),
      THREE.MathUtils.clamp(c.b + j, 0, 1),
    );
  }

  private addDecoration(t: Terrain, x: number, z: number): void {
    if (t === 'home') {
      this.decor.add(this.buildHouse(x, z));
    } else if (t === 'blocked') {
      const g = new THREE.Group();
      const trees = 1 + ((Math.random() * 2) | 0);
      for (let k = 0; k < trees; k++) {
        const ox = (Math.random() - 0.5) * 0.9;
        const oz = (Math.random() - 0.5) * 0.9;
        if (Math.random() < 0.6) g.add(this.buildTree(x + ox, z + oz));
        else g.add(this.buildRock(x + ox, z + oz));
      }
      this.decor.add(g);
    }
  }

  private buildTree(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6),
      new THREE.MeshLambertMaterial({ color: 0xb98a5e }),
    );
    trunk.position.set(x, 0.15, z);
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.5, 8),
      new THREE.MeshLambertMaterial({ color: 0x6fc27a }),
    );
    foliage.position.set(x, 0.5, z);
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x8fd98f }),
    );
    puff.position.set(x, 0.72, z);
    g.add(trunk, foliage, puff);
    return g;
  }

  private buildRock(x: number, z: number): THREE.Mesh {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.2),
      new THREE.MeshLambertMaterial({ color: 0xb9bec8 }),
    );
    rock.position.set(x, 0.16, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = 0.7;
    return rock;
  }

  private buildHouse(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.5, 0.6),
      new THREE.MeshLambertMaterial({ color: 0xfff2e0 }),
    );
    body.position.set(x, 0.25, z);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(0.52, 0.4, 4),
      new THREE.MeshLambertMaterial({ color: 0xff8fab }),
    );
    roof.position.set(x, 0.7, z);
    roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.26, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xc98a5e }),
    );
    door.position.set(x, 0.13, z + 0.31);
    g.add(body, roof, door);
    return g;
  }

  // ---- towers ---------------------------------------------------------------

  private towerHashOf(towers: Tower[]): string {
    let h = '';
    for (const t of towers) h += t.id + ':' + t.kind + ':' + t.dmgLevel + ':' + t.spdLevel + '|';
    return h;
  }

  private rebuildTowers(towers: Tower[]): void {
    this.clearTowers();
    for (const t of towers) {
      const { x, z } = hexToWorld(t.q, t.r);
      const built = this.buildTower(t);
      built.group.position.set(x, 0, z);
      this.towerGroup.add(built.group);
      this.towerObjs.set(t.id, built);
    }
  }

  private buildTower(t: Tower): { group: THREE.Group; pulse: THREE.Object3D[] } {
    const g = new THREE.Group();
    const pulse: THREE.Object3D[] = [];
    const accent = C.TOWER_COLOR[t.kind];
    const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8), mat(0xe8e2ea));
    post.position.y = 0.175;

    switch (t.kind) {
      case 'plinker': {
        g.add(post);
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 8), mat(accent));
        turret.position.y = 0.45;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(C.TOWER_TRIM));
        ball.position.set(0, 0.55, 0.14);
        g.add(turret, ball);
        break;
      }
      case 'freeze': {
        g.add(post);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), mat(accent));
        crystal.position.y = 0.62;
        pulse.push(crystal);
        g.add(crystal);
        break;
      }
      case 'cannon': {
        g.add(post);
        const base = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(accent));
        base.position.y = 0.46;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10), mat(0x8a6b4f));
        barrel.position.set(0, 0.5, 0.22);
        barrel.rotation.x = Math.PI / 2.4;
        g.add(base, barrel);
        break;
      }
      case 'lightning': {
        g.add(post);
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.03, 0.04, 8, 14), mat(accent));
          ring.position.y = 0.42 + i * 0.12;
          ring.rotation.x = Math.PI / 2;
          g.add(ring);
        }
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(C.TOWER_TRIM));
        orb.position.y = 0.82;
        pulse.push(orb);
        g.add(orb);
        break;
      }
      case 'doom': {
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.4, 8), mat(0x5a4a55));
        pedestal.position.y = 0.2;
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(accent));
        orb.position.y = 0.72;
        pulse.push(orb);
        g.add(pedestal, orb);
        break;
      }
    }

    // Upgrade level shown as small stacked rings around the base.
    const level = t.dmgLevel + t.spdLevel;
    for (let i = 0; i < level; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.028, 6, 16),
        mat(i % 2 === 0 ? 0xffd166 : 0xff8fab),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04 + i * 0.05;
      g.add(ring);
    }

    return { group: g, pulse };
  }

  // ---- per-frame render -----------------------------------------------------

  render(state: GameState, dt: number, events?: readonly SimEvent[]): void {
    // Towers: rebuild only when composition/levels change.
    const hash = this.towerHashOf(state.towers);
    if (hash !== this.towerHash) {
      this.rebuildTowers(state.towers);
      this.towerHash = hash;
    }

    // Position lookup maps (reused each frame).
    this.towerPosById.clear();
    for (const t of state.towers) {
      const { x, z } = hexToWorld(t.q, t.r);
      this.towerPosById.set(t.id, { x, z });
    }
    this.enemyPosById.clear();
    for (const e of state.enemies) this.enemyPosById.set(e.id, { x: e.x, z: e.z });

    this.updateEnemies(state);
    this.updateDoomPulse(state.time);

    // Effects from this frame's events (UI may pass concatenated multi-step events).
    const evs = events ?? state.events;
    if (evs && evs.length) {
      this.effects.consume(
        evs,
        (id) => this.towerPosById.get(id) ?? null,
        (id) => this.enemyPosById.get(id) ?? null,
        this.homeWorld,
      );
    }
    this.effects.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  private updateEnemies(state: GameState): void {
    const counts: Record<EnemyKind, number> = { regular: 0, fast: 0, shield: 0, boss: 0 };
    let bubbleCount = 0;
    let barIdx = 0;

    for (const e of state.enemies) {
      const em = this.enemyMeshes[e.kind];
      const idx = counts[e.kind]++;
      if (idx >= ENEMY_CAP) continue;

      const hpFrac = e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 1;
      const wob = Math.sin(state.time * 4 + e.id * 1.7);
      const bob = wob * 0.05;
      const squash = 1 + wob * 0.06;
      const scale = em.radius * (0.72 + 0.28 * hpFrac);

      this.dummy.position.set(e.x, em.y + bob + scale * 0.02, e.z);
      this.dummy.rotation.set(0, state.time * 0.6 + e.id, 0);
      this.dummy.scale.set(scale / em.radius, (scale / em.radius) * squash, scale / em.radius);
      this.dummy.updateMatrix();
      em.mesh.setMatrixAt(idx, this.dummy.matrix);

      // Shield bubble.
      if (e.kind === 'shield' && e.maxShield > 0 && e.shield > 0 && bubbleCount < ENEMY_CAP) {
        const sf = 0.6 + 0.4 * (e.shield / e.maxShield);
        this.dummy.position.set(e.x, em.y + bob, e.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(sf);
        this.dummy.updateMatrix();
        this.shieldBubble.setMatrixAt(bubbleCount++, this.dummy.matrix);
      }

      // Boss hp bar billboard.
      if (e.kind === 'boss' && barIdx < this.hpBars.length) {
        const bar = this.hpBars[barIdx++];
        bar.group.visible = true;
        bar.group.position.set(e.x, em.y + 1.4, e.z);
        bar.group.quaternion.copy(this.camera.quaternion);
        bar.fill.scale.x = Math.max(0.001, hpFrac);
        bar.mat.color.setRGB(1 - hpFrac * 0.7, 0.4 + hpFrac * 0.5, 0.35);
      }
    }

    (Object.keys(this.enemyMeshes) as EnemyKind[]).forEach((k) => {
      const em = this.enemyMeshes[k];
      em.mesh.count = Math.min(counts[k], ENEMY_CAP);
      em.mesh.instanceMatrix.needsUpdate = true;
    });
    this.shieldBubble.count = bubbleCount;
    this.shieldBubble.instanceMatrix.needsUpdate = true;
    for (let i = barIdx; i < this.hpBars.length; i++) this.hpBars[i].group.visible = false;
  }

  private updateDoomPulse(time: number): void {
    const s = 1 + Math.sin(time * 2.2) * 0.08;
    for (const { pulse } of this.towerObjs.values()) {
      for (const p of pulse) p.scale.setScalar(s);
    }
  }

  // ---- picking / hover / range ---------------------------------------------

  pickHex(clientX: number, clientY: number): { q: number; r: number } | null {
    if (!this.map) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.tmpVec2.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.tmpVec2, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpVec3);
    if (!hit) return null;

    // Invert hexToWorld: x = 1.5q ; z = sqrt3 (r + q/2).
    const q = hit.x / (HEX_SIZE * 1.5);
    const r = hit.z / (HEX_SIZE * SQRT3) - q / 2;
    const rounded = this.axialRound(q, r);
    return this.cellExists.has(rounded.q + ',' + rounded.r) ? rounded : null;
  }

  private axialRound(q: number, r: number): { q: number; r: number } {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  setHover(hex: { q: number; r: number } | null, valid: boolean): void {
    if (!this.terrain) return;
    // Restore previous hovered instance.
    if (this.hoverIndex >= 0) {
      this.terrain.setColorAt(this.hoverIndex, this.baseColors[this.hoverIndex]);
      this.hoverIndex = -1;
    }
    if (hex) {
      const idx = this.cellIndex.get(hex.q + ',' + hex.r);
      if (idx !== undefined) {
        this.tmpColor.setHex(valid ? HOVER_VALID : HOVER_INVALID);
        this.terrain.setColorAt(idx, this.tmpColor);
        this.hoverIndex = idx;
      }
    }
    if (this.terrain.instanceColor) this.terrain.instanceColor.needsUpdate = true;
  }

  showRange(x: number, z: number, range: number): void {
    this.rangeDisc.position.set(x, 0.05, z);
    this.rangeDisc.scale.setScalar(range);
    this.rangeDisc.visible = true;
  }

  hideRange(): void {
    this.rangeDisc.visible = false;
  }

  // ---- camera / resize ------------------------------------------------------

  private frameCamera(): void {
    const w = this.canvas.clientWidth || this.canvas.width || 1;
    const h = this.canvas.clientHeight || this.canvas.height || 1;
    const aspect = w / h;
    this.camera.aspect = aspect;

    const vHalf = (this.camera.fov * Math.PI) / 180 / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const distV = this.frameRadius / Math.sin(vHalf);
    const distH = this.frameRadius / Math.sin(hHalf);
    const dist = Math.max(distV, distH) * 1.12;

    const dir = this.tmpVec3.set(0, Math.sin(this.elevation), Math.cos(this.elevation));
    this.camera.position.set(
      this.target.x + dir.x * dist,
      this.target.y + dir.y * dist,
      this.target.z + dir.z * dist,
    );
    this.camera.lookAt(this.target);
    this.camera.far = dist * 2 + 100;
    this.camera.updateProjectionMatrix();

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = dist * 0.55;
      this.scene.fog.far = dist * 2.1;
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || this.canvas.width || 1;
    const h = this.canvas.clientHeight || this.canvas.height || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    if (this.map) this.frameCamera();
    else {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- teardown -------------------------------------------------------------

  private clearTerrain(): void {
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.dispose();
      this.terrain = null;
    }
    this.disposeGroup(this.decor);
  }

  private clearTowers(): void {
    for (const { group } of this.towerObjs.values()) {
      this.disposeGroup(group);
      this.towerGroup.remove(group);
    }
    this.towerObjs.clear();
  }

  private disposeGroup(group: THREE.Group): void {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      if (child instanceof THREE.Group) this.disposeGroup(child);
      else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const m = child.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
      group.remove(child);
    }
  }

  dispose(): void {
    this.clearTerrain();
    this.clearTowers();
    this.effects.dispose();

    this.terrainGeo.dispose();
    this.terrainMat.dispose();
    for (const k of Object.keys(this.enemyMeshes) as EnemyKind[]) {
      const em = this.enemyMeshes[k];
      em.mesh.geometry.dispose();
      (em.mesh.material as THREE.Material).dispose();
    }
    for (const tex of this.faceTextures) tex.dispose();
    this.shieldBubble.geometry.dispose();
    (this.shieldBubble.material as THREE.Material).dispose();
    for (const bar of this.hpBars) this.disposeGroup(bar.group);
    this.rangeDisc.geometry.dispose();
    (this.rangeDisc.material as THREE.Material).dispose();

    this.renderer.dispose();
  }
}
