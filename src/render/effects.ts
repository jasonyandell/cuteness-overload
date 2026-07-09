// Pooled, allocation-free cosmetic effects driven by SimEvents.
// The sim is hitscan; these are pure eye-candy: tracers, chains, aoe rings,
// death confetti and leak flashes. All objects are created once and recycled.

import * as THREE from 'three';
import type { SimEvent, TowerKind } from '../sim/types';
import { AOE_COLOR, SHOT_COLOR, LEAK_FLASH, CONFETTI, HEARTS } from './theme';
import { makeDotTexture, makeHeartTexture } from './textures';

type Vec2 = { x: number; z: number };

interface Spark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  ttl: number;
  sx: number; sz: number;
  ex: number; ez: number;
  y: number;
}

interface Bolt {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  ttl: number;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  ttl: number;
  r0: number;
  r1: number;
}

interface Confetti {
  spr: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  ttl: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

interface Heart {
  spr: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  ttl: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
}

const SPARK_CAP = 48;
const BOLT_CAP = 24;
const RING_CAP = 28;
const CONFETTI_CAP = 200;
const HEART_CAP = 160;

const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  private group = new THREE.Group();
  private sparks: Spark[] = [];
  private bolts: Bolt[] = [];
  private rings: Ring[] = [];
  private confetti: Confetti[] = [];
  private hearts: Heart[] = [];
  private dot: THREE.CanvasTexture;
  private heartTex: THREE.CanvasTexture;

  // Reused scratch objects (no per-frame allocation).
  private tmpDir = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    this.dot = makeDotTexture();
    this.heartTex = makeHeartTexture();

    const sparkGeo = new THREE.SphereGeometry(0.12, 8, 6);
    for (let i = 0; i < SPARK_CAP; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.sparks.push({ mesh, mat, active: false, age: 0, ttl: 0, sx: 0, sz: 0, ex: 0, ez: 0, y: 0 });
    }

    const boltGeo = new THREE.BoxGeometry(0.06, 1, 0.06);
    for (let i = 0; i < BOLT_CAP; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(boltGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.bolts.push({ mesh, mat, active: false, age: 0, ttl: 0 });
    }

    const ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    ringGeo.rotateX(-Math.PI / 2); // lie flat on the ground
    for (let i = 0; i < RING_CAP; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, active: false, age: 0, ttl: 0, r0: 0, r1: 0 });
    }

    for (let i = 0; i < CONFETTI_CAP; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.dot, transparent: true, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.scale.setScalar(0.22);
      this.group.add(spr);
      this.confetti.push({
        spr, mat, active: false, age: 0, ttl: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      });
    }

    for (let i = 0; i < HEART_CAP; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.heartTex, transparent: true, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      this.group.add(spr);
      this.hearts.push({
        spr, mat, active: false, age: 0, ttl: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.3,
      });
    }
  }

  private grabSpark(): Spark {
    for (const s of this.sparks) if (!s.active) return s;
    // recycle oldest
    let oldest = this.sparks[0];
    for (const s of this.sparks) if (s.age > oldest.age) oldest = s;
    return oldest;
  }
  private grabBolt(): Bolt {
    for (const b of this.bolts) if (!b.active) return b;
    let oldest = this.bolts[0];
    for (const b of this.bolts) if (b.age > oldest.age) oldest = b;
    return oldest;
  }
  private grabRing(): Ring {
    for (const r of this.rings) if (!r.active) return r;
    let oldest = this.rings[0];
    for (const r of this.rings) if (r.age > oldest.age) oldest = r;
    return oldest;
  }
  private grabConfetti(): Confetti {
    for (const c of this.confetti) if (!c.active) return c;
    let oldest = this.confetti[0];
    for (const c of this.confetti) if (c.age > oldest.age) oldest = c;
    return oldest;
  }
  private grabHeart(): Heart {
    for (const h of this.hearts) if (!h.active) return h;
    let oldest = this.hearts[0];
    for (const h of this.hearts) if (h.age > oldest.age) oldest = h;
    return oldest;
  }

  private spawnShot(from: Vec2, to: Vec2, kind: TowerKind, y: number) {
    const s = this.grabSpark();
    s.active = true;
    s.age = 0;
    s.ttl = 0.13;
    s.sx = from.x; s.sz = from.z;
    s.ex = to.x; s.ez = to.z;
    s.y = y;
    s.mat.color.setHex(SHOT_COLOR[kind]);
    s.mat.opacity = 1;
    s.mesh.visible = true;
    s.mesh.position.set(from.x, y, from.z);
  }

  private spawnBolt(a: Vec2, b: Vec2, y: number, color: number, ttl: number) {
    const bolt = this.grabBolt();
    bolt.active = true;
    bolt.age = 0;
    bolt.ttl = ttl;
    bolt.mat.color.setHex(color);
    bolt.mat.opacity = 1;
    bolt.mesh.visible = true;
    this.tmpA.set(a.x, y, a.z);
    this.tmpB.set(b.x, y, b.z);
    const len = this.tmpA.distanceTo(this.tmpB);
    bolt.mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    this.tmpDir.subVectors(this.tmpB, this.tmpA).normalize();
    bolt.mesh.quaternion.setFromUnitVectors(UP, this.tmpDir);
    bolt.mesh.scale.set(1, Math.max(0.001, len), 1);
  }

  private spawnRing(x: number, z: number, r0: number, r1: number, color: number, ttl: number) {
    const ring = this.grabRing();
    ring.active = true;
    ring.age = 0;
    ring.ttl = ttl;
    ring.r0 = r0;
    ring.r1 = r1;
    ring.mat.color.setHex(color);
    ring.mat.opacity = 0.85;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, 0.06, z);
    ring.mesh.scale.setScalar(r0);
  }

  private spawnBurst(x: number, z: number) {
    const n = 16; // big celebratory pop
    for (let i = 0; i < n; i++) {
      const c = this.grabConfetti();
      c.active = true;
      c.age = 0;
      c.ttl = 0.6 + Math.random() * 0.4;
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const spd = 2.2 + Math.random() * 2.6;
      c.x = x; c.y = 0.6; c.z = z;
      c.vx = Math.cos(ang) * spd;
      c.vz = Math.sin(ang) * spd;
      c.vy = 3.5 + Math.random() * 2.2;
      c.mat.color.setHex(CONFETTI[(Math.random() * CONFETTI.length) | 0]);
      c.mat.opacity = 1;
      c.spr.scale.setScalar(0.3 + Math.random() * 0.22); // chunkier bits
      c.spr.visible = true;
      c.spr.position.set(c.x, c.y, c.z);
    }
  }

  // Death poof: a gentle upward burst of hearts. No gore — the cutie is simply
  // overcome with love and floats away.
  private spawnHearts(x: number, z: number) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const h = this.grabHeart();
      h.active = true;
      h.age = 0;
      h.ttl = 0.7 + Math.random() * 0.5;
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const spd = 0.6 + Math.random() * 1.1;
      h.x = x; h.y = 0.55; h.z = z;
      h.vx = Math.cos(ang) * spd;
      h.vz = Math.sin(ang) * spd;
      h.vy = 1.8 + Math.random() * 1.2; // float up
      h.size = 0.34 + Math.random() * 0.22;
      h.mat.color.setHex(HEARTS[(Math.random() * HEARTS.length) | 0]);
      h.mat.opacity = 1;
      h.mat.rotation = (Math.random() - 0.5) * 0.6;
      h.spr.scale.setScalar(0.001);
      h.spr.visible = true;
      h.spr.position.set(h.x, h.y, h.z);
    }
  }

  /**
   * Turn one tick's events into effects. `towerPos`/`enemyPos` resolve ids to
   * world positions at the moment of consumption; missing ids are skipped
   * gracefully (target may have already died this tick).
   */
  consume(
    events: readonly SimEvent[],
    towerPos: (id: number) => Vec2 | null,
    enemyPos: (id: number) => Vec2 | null,
    homePos: Vec2,
  ) {
    for (const ev of events) {
      switch (ev.type) {
        case 'shot': {
          const from = towerPos(ev.towerId);
          const to = enemyPos(ev.targetId);
          if (from && to) this.spawnShot(from, to, ev.kind, 0.6);
          break;
        }
        case 'chain': {
          const a = enemyPos(ev.fromId);
          const b = enemyPos(ev.toId);
          if (a && b) this.spawnBolt(a, b, 0.6, AOE_COLOR.lightning, 0.16);
          break;
        }
        case 'aoe': {
          this.spawnRing(ev.x, ev.z, Math.max(0.2, ev.radius * 0.3), ev.radius, AOE_COLOR[ev.kind], 0.4);
          break;
        }
        case 'die': {
          this.spawnHearts(ev.x, ev.z);
          this.spawnBurst(ev.x, ev.z);
          this.spawnRing(ev.x, ev.z, 0.3, 1.7, 0xffc0d8, 0.35);
          break;
        }
        case 'leak': {
          this.spawnRing(homePos.x, homePos.z, 0.3, 2.4, LEAK_FLASH, 0.45);
          break;
        }
        default:
          break;
      }
    }
  }

  update(dt: number) {
    for (const s of this.sparks) {
      if (!s.active) continue;
      s.age += dt;
      const t = s.age / s.ttl;
      if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
      s.mesh.position.set(s.sx + (s.ex - s.sx) * t, s.y, s.sz + (s.ez - s.sz) * t);
      s.mat.opacity = 1 - t * t;
    }
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      const t = b.age / b.ttl;
      if (t >= 1) { b.active = false; b.mesh.visible = false; continue; }
      b.mat.opacity = 1 - t;
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.ttl;
      if (t >= 1) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * t);
      r.mat.opacity = 0.85 * (1 - t);
    }
    for (const c of this.confetti) {
      if (!c.active) continue;
      c.age += dt;
      const t = c.age / c.ttl;
      if (t >= 1) { c.active = false; c.spr.visible = false; continue; }
      c.vy -= 9 * dt; // gravity
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      if (c.y < 0.05) { c.y = 0.05; c.vy = 0; c.vx *= 0.6; c.vz *= 0.6; }
      c.spr.position.set(c.x, c.y, c.z);
      c.mat.opacity = 1 - t * t;
    }
    for (const h of this.hearts) {
      if (!h.active) continue;
      h.age += dt;
      const t = h.age / h.ttl;
      if (t >= 1) { h.active = false; h.spr.visible = false; continue; }
      h.vy -= 2.4 * dt;    // rise, then ease off (lighter than gravity)
      h.vx *= 0.96; h.vz *= 0.96;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.z += h.vz * dt;
      // Pop in fast, then linger and fade.
      const pop = Math.min(1, t * 6);
      h.spr.scale.setScalar(h.size * pop);
      h.spr.position.set(h.x, h.y, h.z);
      h.mat.opacity = 1 - t * t;
    }
  }

  dispose() {
    for (const s of this.sparks) { s.mesh.geometry.dispose(); s.mat.dispose(); }
    for (const b of this.bolts) { b.mesh.geometry.dispose(); b.mat.dispose(); }
    for (const r of this.rings) { r.mesh.geometry.dispose(); r.mat.dispose(); }
    for (const c of this.confetti) c.mat.dispose();
    for (const h of this.hearts) h.mat.dispose();
    this.dot.dispose();
    this.heartTex.dispose();
    this.group.removeFromParent();
  }
}
