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
  hopFreq: number; // springy walk cadence
  hopHeight: number; // hop amplitude (world units)
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
  // Health bars: instanced billboard pair (backdrop + left-anchored fill) shown
  // over every enemy that is below full health.
  private hpBarBg: THREE.InstancedMesh;
  private hpBarFill: THREE.InstancedMesh;

  // Towers (rebuilt on change, keyed by a levels hash).
  private towerGroup = new THREE.Group();
  private towerObjs = new Map<number, { group: THREE.Group; pulse: THREE.Object3D[] }>();
  private towerHash = '';

  // Hover + range.
  private hoverIndex = -1;
  private rangeDisc: THREE.Mesh;

  // Camera framing.
  private target = new THREE.Vector3(); // = baseTarget + panOffset (derived)
  private baseTarget = new THREE.Vector3(); // map center
  private panOffset = new THREE.Vector3(); // drag-pan offset on the ground
  private bboxMin = new THREE.Vector3();
  private bboxMax = new THREE.Vector3();
  private camDist = 20; // current camera distance from target
  private readonly elevation = (52 * Math.PI) / 180;
  private readonly zoomIn = 0.6; // <1 zooms in past the exact fit (map may overflow)

  // Picking.
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Scratch (no per-frame allocation).
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpVec2 = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();
  private tmpCorner = new THREE.Vector3();
  private enemyPosById = new Map<number, { x: number; z: number }>();
  private towerPosById = new Map<number, { x: number; z: number }>();
  private homeWorld = { x: 0, z: 0 };
  private spawnAt = new Map<number, number>(); // enemyId -> sim time it spawned (boing)
  private fireAt = new Map<number, number>(); // towerId -> sim time it last fired (recoil pop)

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
    // Big, chunky preschool-toy proportions — overlap between neighbors is fine.
    const box = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    this.enemyMeshes = {
      regular: this.buildEnemyMesh('regular', box, 0.5, 0.95, 6.5, 0.28),
      fast: this.buildEnemyMesh('fast', new THREE.TetrahedronGeometry(0.75), 0.5, 0.75, 10, 0.36),
      shield: this.buildEnemyMesh('shield', new THREE.OctahedronGeometry(0.8), 0.62, 0.8, 5.5, 0.22),
      boss: this.buildEnemyMesh('boss', new THREE.IcosahedronGeometry(1.5), 1.15, 1.5, 3.2, 0.3),
    };

    // Translucent shield bubbles (shared instanced sphere) sized to wrap Shelly.
    const bubbleGeo = new THREE.SphereGeometry(0.95, 14, 12);
    const bubbleMat = new THREE.MeshLambertMaterial({
      color: C.SHIELD_BUBBLE, transparent: true, opacity: 0.32, depthWrite: false,
    });
    this.shieldBubble = new THREE.InstancedMesh(bubbleGeo, bubbleMat, ENEMY_CAP);
    this.shieldBubble.count = 0;
    this.shieldBubble.frustumCulled = false;
    this.scene.add(this.shieldBubble);

    // Health bars for damaged enemies (instanced, drawn over everything).
    const barBgGeo = new THREE.PlaneGeometry(1, 0.14);
    const barBgMat = new THREE.MeshBasicMaterial({
      color: 0x33323a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85,
    });
    this.hpBarBg = new THREE.InstancedMesh(barBgGeo, barBgMat, ENEMY_CAP);
    this.hpBarBg.count = 0;
    this.hpBarBg.frustumCulled = false;
    this.hpBarBg.renderOrder = 998;
    this.scene.add(this.hpBarBg);

    // Fill plane spans x in [0,1] (left edge at origin) so scale.x = hp fraction
    // grows rightward; nudged toward the camera to sit on top of the backdrop.
    const barFillGeo = new THREE.PlaneGeometry(1, 0.09);
    barFillGeo.translate(0.5, 0, 0.01);
    const barFillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, depthTest: false, depthWrite: false, transparent: true,
    });
    this.hpBarFill = new THREE.InstancedMesh(barFillGeo, barFillMat, ENEMY_CAP);
    this.hpBarFill.count = 0;
    this.hpBarFill.frustumCulled = false;
    this.hpBarFill.renderOrder = 999;
    this.scene.add(this.hpBarFill);

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

  private buildEnemyMesh(
    kind: EnemyKind, geo: THREE.BufferGeometry, y: number, radius: number,
    hopFreq: number, hopHeight: number,
  ): EnemyMesh {
    const tex = makeFaceTexture(C.ENEMY_COLOR[kind]);
    this.faceTextures.push(tex);
    // emissiveMap = same face texture so the body colour + face glow even in
    // shadow: enemies read as bright primaries with visible faces regardless of
    // lighting angle, and can never render as dark/black silhouettes.
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, ENEMY_CAP);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, y, radius, hopFreq, hopHeight };
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

    // Camera framing from map bounds (include a little vertical headroom for
    // houses / towers so nothing clips at the top edge).
    const pad = HEX_SIZE * 0.6;
    this.bboxMin.set(minX - pad, -HEX_H, minZ - pad);
    this.bboxMax.set(maxX + pad, 1.8, maxZ + pad);
    this.baseTarget.set((minX + maxX) / 2, 0.2, (minZ + maxZ) / 2);
    this.panOffset.set(0, 0, 0);
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

    // Fat, rounded chunky base for every tower (Duplo-ish).
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.5, 14), mat(0xf3eef6));
    post.position.y = 0.25;

    switch (t.kind) {
      case 'plinker': {
        g.add(post);
        const turret = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(accent));
        turret.position.y = 0.72;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(C.TOWER_TRIM));
        ball.position.set(0, 0.78, 0.28);
        g.add(turret, ball);
        break;
      }
      case 'freeze': {
        g.add(post);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.44), mat(accent));
        crystal.position.y = 1.0;
        pulse.push(crystal);
        g.add(crystal);
        break;
      }
      case 'cannon': {
        g.add(post);
        const base = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), mat(accent));
        base.position.y = 0.72;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.7, 12), mat(0x4a3f46));
        barrel.position.set(0, 0.82, 0.34);
        barrel.rotation.x = Math.PI / 2.4;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(C.TOWER_TRIM));
        cap.position.set(0, 1.06, 0.56);
        g.add(base, barrel, cap);
        break;
      }
      case 'lightning': {
        g.add(post);
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28 - i * 0.06, 0.07, 10, 18), mat(accent));
          ring.position.y = 0.66 + i * 0.2;
          ring.rotation.x = Math.PI / 2;
          g.add(ring);
        }
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(C.TOWER_TRIM));
        orb.position.y = 1.28;
        pulse.push(orb);
        g.add(orb);
        break;
      }
      case 'doom': {
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.56, 0.56, 12), mat(0x3e3345));
        pedestal.position.y = 0.28;
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.52, 20, 16), mat(accent));
        orb.position.y = 1.05;
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 10, 24), mat(0xffffff));
        halo.position.y = 1.05;
        halo.rotation.x = Math.PI / 2;
        pulse.push(orb, halo);
        g.add(pedestal, orb, halo);
        break;
      }
    }

    // Upgrade level shown as chunky stacked rings around the base.
    const level = t.dmgLevel + t.spdLevel;
    for (let i = 0; i < level; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.05, 8, 20),
        mat(i % 2 === 0 ? 0xffd21e : 0xff4136),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06 + i * 0.09;
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

    const evs = events ?? state.events;
    if (evs && evs.length) this.consumeStyleEvents(evs, state);

    this.updateEnemies(state);
    this.updateTowers(state);

    // Effects from this frame's events (UI may pass concatenated multi-step events).
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

      // Springy walk: |sin| gives a bouncing hop that touches the ground; the
      // body squashes at the bottom of the hop and stretches at the top.
      const phase = state.time * em.hopFreq + e.id * 1.7;
      const hop = Math.abs(Math.sin(phase)); // 0 at ground, 1 at apex
      const hopY = em.hopHeight * hop;
      const stretch = (hop - 0.45) * 0.4; // squashed low, stretched high
      const sy = 1 + stretch;
      const sxz = 1 - stretch * 0.55;

      // Spawn "boing": scale in with a springy overshoot for ~0.45s.
      const spawnAt = this.spawnAt.get(e.id);
      let boing = 1;
      if (spawnAt !== undefined) {
        const age = state.time - spawnAt;
        if (age >= 0.5) this.spawnAt.delete(e.id);
        else boing = this.boingScale(Math.max(0, age) / 0.5);
      }

      const baseScale = em.radius * (0.8 + 0.2 * hpFrac) * boing;
      const norm = baseScale / em.radius;

      // Keep the cute face toward the camera (which looks along -z); a gentle
      // wobble instead of a full spin so the eyes stay readable.
      this.dummy.position.set(e.x, em.y + hopY, e.z);
      this.dummy.rotation.set(0, Math.sin(state.time * 2.2 + e.id) * 0.22, Math.sin(phase) * 0.1);
      this.dummy.scale.set(norm * sxz, norm * sy, norm * sxz);
      this.dummy.updateMatrix();
      em.mesh.setMatrixAt(idx, this.dummy.matrix);

      // Shield bubble (wraps Shelly, bobs with her hop).
      if (e.kind === 'shield' && e.maxShield > 0 && e.shield > 0 && bubbleCount < ENEMY_CAP) {
        const sf = (0.82 + 0.2 * (e.shield / e.maxShield)) * boing;
        this.dummy.position.set(e.x, em.y + hopY, e.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(sf);
        this.dummy.updateMatrix();
        this.shieldBubble.setMatrixAt(bubbleCount++, this.dummy.matrix);
      }

      // Health bar billboard over any cutie that has taken damage.
      if (e.hp < e.maxHp && barIdx < ENEMY_CAP) {
        const w = e.kind === 'boss' ? 1.9 : em.radius * 1.15;
        const y = em.y + em.radius + (e.kind === 'boss' ? 0.9 : 0.35) + hopY;

        this.dummy.position.set(e.x, y, e.z);
        this.dummy.quaternion.copy(this.camera.quaternion);
        this.dummy.scale.set(w, 1, 1);
        this.dummy.updateMatrix();
        this.hpBarBg.setMatrixAt(barIdx, this.dummy.matrix);

        // Fill is left-anchored: shift its origin half a bar to the left along
        // the billboard's local x, then scale by the hp fraction.
        this.tmpVec3.set(-w / 2, 0, 0).applyQuaternion(this.camera.quaternion);
        this.dummy.position.set(e.x + this.tmpVec3.x, y + this.tmpVec3.y, e.z + this.tmpVec3.z);
        this.dummy.scale.set(Math.max(0.001, hpFrac) * w, 1, 1);
        this.dummy.updateMatrix();
        this.hpBarFill.setMatrixAt(barIdx, this.dummy.matrix);
        this.hpBarFill.setColorAt(
          barIdx,
          this.tmpColor.setRGB(1 - hpFrac * 0.7, 0.4 + hpFrac * 0.5, 0.35),
        );
        barIdx++;
      }
    }

    (Object.keys(this.enemyMeshes) as EnemyKind[]).forEach((k) => {
      const em = this.enemyMeshes[k];
      em.mesh.count = Math.min(counts[k], ENEMY_CAP);
      em.mesh.instanceMatrix.needsUpdate = true;
    });
    this.shieldBubble.count = bubbleCount;
    this.shieldBubble.instanceMatrix.needsUpdate = true;
    this.hpBarBg.count = barIdx;
    this.hpBarBg.instanceMatrix.needsUpdate = true;
    this.hpBarFill.count = barIdx;
    this.hpBarFill.instanceMatrix.needsUpdate = true;
    if (this.hpBarFill.instanceColor) this.hpBarFill.instanceColor.needsUpdate = true;
  }

  /** easeOutBack: 0 -> overshoot(~1.1) -> 1, for a friendly cartoon pop-in. */
  private boingScale(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    const p = t - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  }

  /** Record cosmetic timings from this frame's events (spawn boing, fire pop). */
  private consumeStyleEvents(events: readonly SimEvent[], state: GameState): void {
    for (const ev of events) {
      if (ev.type === 'spawn') this.spawnAt.set(ev.enemyId, state.time);
      else if (ev.type === 'die' || ev.type === 'leak') this.spawnAt.delete(ev.enemyId);
      else if (ev.type === 'shot') this.fireAt.set(ev.towerId, state.time);
      else if (ev.type === 'aoe') {
        // aoe carries no towerId; pop the nearest same-kind tower in range.
        let best = -1, bestD = Infinity;
        for (const t of state.towers) {
          if (t.kind !== ev.kind) continue;
          const p = this.towerPosById.get(t.id);
          if (!p) continue;
          const d = (p.x - ev.x) * (p.x - ev.x) + (p.z - ev.z) * (p.z - ev.z);
          if (d < bestD) { bestD = d; best = t.id; }
        }
        if (best >= 0) this.fireAt.set(best, state.time);
      }
    }
  }

  private updateTowers(state: GameState): void {
    const pulse = 1 + Math.sin(state.time * 2.2) * 0.08; // idle glow for orbs/crystals
    for (const [id, obj] of this.towerObjs) {
      for (const p of obj.pulse) p.scale.setScalar(pulse);

      // Recoil pop: quick squat-and-spring when the tower fires.
      const firedAt = this.fireAt.get(id);
      if (firedAt !== undefined) {
        const age = state.time - firedAt;
        if (age >= 0.22) {
          this.fireAt.delete(id);
          obj.group.scale.set(1, 1, 1);
        } else {
          const k = 1 - age / 0.22; // 1 -> 0
          const kick = k * k;
          obj.group.scale.set(1 + 0.16 * kick, 1 - 0.2 * kick, 1 + 0.16 * kick);
        }
      }
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
    this.camera.aspect = w / h;

    // Fixed viewing direction (no orbit); solve for the closest distance that
    // keeps the whole map AABB inside the viewport with a small margin, then
    // zoom IN past that fit so hexes are big and tappable (map may overflow —
    // the player drags to pan). The fit is measured about the map center.
    this.target.copy(this.baseTarget);
    const dir = this.tmpVec3.set(0, Math.sin(this.elevation), Math.cos(this.elevation));
    const mn = this.bboxMin, mx = this.bboxMax;

    const fits = (dist: number): boolean => {
      this.camera.position.set(
        this.target.x + dir.x * dist,
        this.target.y + dir.y * dist,
        this.target.z + dir.z * dist,
      );
      this.camera.lookAt(this.target);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
      const limit = 0.94; // NDC margin
      for (let cx = 0; cx < 2; cx++)
        for (let cy = 0; cy < 2; cy++)
          for (let cz = 0; cz < 2; cz++) {
            this.tmpCorner
              .set(cx ? mx.x : mn.x, cy ? mx.y : mn.y, cz ? mx.z : mn.z)
              .project(this.camera);
            if (Math.abs(this.tmpCorner.x) > limit || Math.abs(this.tmpCorner.y) > limit) return false;
          }
      return true;
    };

    const span = Math.hypot(mx.x - mn.x, mx.z - mn.z) + 2;
    let lo = span * 0.15;
    let hi = span * 4;
    if (!fits(hi)) hi *= 3;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.camDist = hi * this.zoomIn;
    this.applyCamera();
  }

  /** Position the camera from the current target (baseTarget + panOffset). */
  private applyCamera(): void {
    this.target.copy(this.baseTarget).add(this.panOffset);
    const dir = this.tmpVec3.set(0, Math.sin(this.elevation), Math.cos(this.elevation));
    this.camera.position.set(
      this.target.x + dir.x * this.camDist,
      this.target.y + dir.y * this.camDist,
      this.target.z + dir.z * this.camDist,
    );
    this.camera.lookAt(this.target);
    this.camera.far = this.camDist * 3 + 100;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.camDist * 0.9;
      this.scene.fog.far = this.camDist * 3.2;
    }
  }

  /**
   * Pan the camera target by a screen-space drag (CSS pixels), clamped so the
   * map center stays within its footprint and the map can't be lost off-screen.
   * The view has no roll and looks along -z, so screen-x maps to world +x and
   * screen-y maps to world +z (foreshortened by the tilt).
   */
  panBy(dxPx: number, dyPx: number): void {
    if (!this.map) return;
    const h = this.canvas.clientHeight || this.canvas.height || 1;
    const vHalf = (this.camera.fov * Math.PI) / 180 / 2;
    const worldPerPx = (2 * this.camDist * Math.tan(vHalf)) / h;
    // Drag-the-map feel: content follows the finger, so the target moves opposite.
    this.panOffset.x -= dxPx * worldPerPx;
    this.panOffset.z -= dyPx * worldPerPx / Math.sin(this.elevation);

    // Clamp so the target never leaves the map footprint.
    const cx = (this.bboxMin.x + this.bboxMax.x) / 2;
    const cz = (this.bboxMin.z + this.bboxMax.z) / 2;
    const halfX = (this.bboxMax.x - this.bboxMin.x) / 2;
    const halfZ = (this.bboxMax.z - this.bboxMin.z) / 2;
    this.panOffset.x = THREE.MathUtils.clamp(this.baseTarget.x + this.panOffset.x, cx - halfX, cx + halfX) - this.baseTarget.x;
    this.panOffset.z = THREE.MathUtils.clamp(this.baseTarget.z + this.panOffset.z, cz - halfZ, cz + halfZ) - this.baseTarget.z;
    this.applyCamera();
  }

  resetPan(): void {
    this.panOffset.set(0, 0, 0);
    this.applyCamera();
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
    this.hpBarBg.geometry.dispose();
    (this.hpBarBg.material as THREE.Material).dispose();
    this.hpBarFill.geometry.dispose();
    (this.hpBarFill.material as THREE.Material).dispose();
    this.rangeDisc.geometry.dispose();
    (this.rangeDisc.material as THREE.Material).dispose();

    this.renderer.dispose();
  }
}
