/**
 * 池化的投射物与延时范围攻击：玩家风刃、敌方光球、地面冲击波、落雷。
 */
import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { Q_WORLD } from '../core/Physics';

interface Blade { m: THREE.Mesh; on: boolean; x: number; y: number; z: number; dx: number; dy: number; dz: number; dist: number; dmg: number; }
interface Orb { m: THREE.Mesh; on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; dmg: number; homing: number; speed: number; color: number; }
interface Wave { m: THREE.Mesh; on: boolean; x: number; y: number; z: number; r: number; maxR: number; speed: number; dmg: number; hit: boolean; }
interface Strike { on: boolean; x: number; y: number; z: number; r: number; t: number; dmg: number; color: number; }

const BLADE_SPEED = 34;
const BLADE_RANGE = 50;

export class Projectiles {
  private blades: Blade[] = [];
  private orbs: Orb[] = [];
  private waves: Wave[] = [];
  private strikes: Strike[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private orbMats = new Map<number, THREE.MeshBasicMaterial>();
  private up = new THREE.Vector3(0, 1, 0);
  private tmp = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    // 风刃：新月形发光片
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 1.25, -1.15, 1.15, false);
    shape.absarc(-0.55, 0, 1.25, 0.85, -0.85, true);
    const bladeGeo = new THREE.ShapeGeometry(shape, 10);
    bladeGeo.rotateX(-Math.PI / 2);
    bladeGeo.rotateY(Math.PI / 2); // 弧面朝 +Z（飞行方向）
    const bladeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 2.2), transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const orbGeo = new THREE.IcosahedronGeometry(0.34, 1);
    const waveGeo = new THREE.TorusGeometry(1, 0.09, 5, 40);
    waveGeo.rotateX(Math.PI / 2);
    const waveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.geos.push(bladeGeo, orbGeo, waveGeo);
    this.mats.push(bladeMat, waveMat);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(g, m); o.visible = false; o.frustumCulled = false; ctx.scene.add(o); return o; };
    for (let i = 0; i < 6; i++) this.blades.push({ m: mk(bladeGeo, bladeMat), on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, dist: 0, dmg: 0 });
    for (let i = 0; i < 40; i++) this.orbs.push({ m: mk(orbGeo, bladeMat), on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, dmg: 0, homing: 0, speed: 0, color: 0 });
    for (let i = 0; i < 8; i++) this.waves.push({ m: mk(waveGeo, waveMat), on: false, x: 0, y: 0, z: 0, r: 0, maxR: 0, speed: 0, dmg: 0, hit: false });
    for (let i = 0; i < 24; i++) this.strikes.push({ on: false, x: 0, y: 0, z: 0, r: 0, t: 0, dmg: 0, color: 0 });
  }

  private orbMat(color: number) {
    let m = this.orbMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.4) });
      this.orbMats.set(color, m);
      this.mats.push(m);
    }
    return m;
  }

  spawnBlade(x: number, y: number, z: number, dx: number, dy: number, dz: number, dmg: number) {
    const b = this.blades.find((k) => !k.on);
    if (!b) return;
    Object.assign(b, { on: true, x, y, z, dx, dy, dz, dist: 0, dmg });
    b.m.visible = true;
    b.m.position.set(x, y, z);
    b.m.quaternion.setFromUnitVectors(this.tmp.set(0, 0, 1), new THREE.Vector3(dx, dy, dz));
  }
  spawnOrb(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, dmg: number, homing = 0, color = 0xff6a9a, life = 5) {
    const o = this.orbs.find((k) => !k.on);
    if (!o) return;
    Object.assign(o, { on: true, x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, life, dmg, homing, speed, color });
    o.m.material = this.orbMat(color);
    o.m.visible = true;
    o.m.position.set(x, y, z);
  }
  /** 贴地扩散的冲击波，跳起可以躲开 */
  spawnWave(x: number, y: number, z: number, r0: number, maxR: number, speed: number, dmg: number) {
    const w = this.waves.find((k) => !k.on);
    if (!w) return;
    Object.assign(w, { on: true, x, y, z, r: r0, maxR, speed, dmg, hit: false });
    w.m.visible = true;
  }
  /** 延时落雷：先显示预警圈，delay 秒后造成范围伤害 */
  spawnStrike(x: number, y: number, z: number, r: number, delay: number, dmg: number, color = 0xc9a8ff) {
    const s = this.strikes.find((k) => !k.on);
    if (!s) return;
    Object.assign(s, { on: true, x, y, z, r, t: delay, dmg, color });
    this.ctx.fx.telegraph(x, y + 0.08, z, r, delay, color);
  }

  update(dt: number) {
    const c = this.ctx;
    const pl = c.player;
    // ---- 风刃
    for (const b of this.blades) {
      if (!b.on) continue;
      const step = BLADE_SPEED * dt;
      const wall = c.physics.raycast(b.x, b.y, b.z, b.dx, b.dy, b.dz, step + 0.3, Q_WORLD);
      b.x += b.dx * step; b.y += b.dy * step; b.z += b.dz * step;
      b.dist += step;
      b.m.position.set(b.x, b.y, b.z);
      b.m.rotateZ(dt * 3);
      c.particles.emit({ n: 2, x: b.x, y: b.y, z: b.z, spread: 0.5, life: 0.35, size: 0.2, color: 0xbfffe8, color2: 0x30d0a0 });
      let done = !!wall || b.dist > BLADE_RANGE;
      if (!done) for (const h of c.world.hittables) {
        if (!h.canBeHit()) continue;
        const dx = h.hitPos.x - b.x, dy = h.hitPos.y - b.y, dz = h.hitPos.z - b.z;
        const rr = h.hitRadius + 0.9;
        if (dx * dx + dz * dz > rr * rr || Math.abs(dy) > h.hitHeight * 0.5 + 0.9) continue;
        const l = Math.hypot(b.dx, b.dz) || 1;
        if (h.onHit({ damage: b.dmg, dirX: b.dx / l, dirZ: b.dz / l, knock: 7, heavy: true, source: 'blade' })) { done = true; c.audio.play('hit'); c.cam.shake(0.18); break; }
      }
      if (done) {
        b.on = false; b.m.visible = false;
        c.fx.burst(b.x, b.y, b.z, 0.3, 1.8, 0.25, 0xa0ffe0, 0.8);
        c.particles.emit({ n: 18, x: b.x, y: b.y, z: b.z, speed: 7, life: 0.4, size: 0.2, color: 0xffffff, color2: 0x40e0b0, drag: 2 });
      }
    }
    // ---- 敌方光球
    const px = pl.pos.x, py = pl.pos.y + 0.9, pz = pl.pos.z;
    for (const o of this.orbs) {
      if (!o.on) continue;
      o.life -= dt;
      if (o.homing > 0 && o.life > 0.6) {
        const dx = px - o.x, dy = py - o.y, dz = pz - o.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, o.homing * dt);
        o.vx += ((dx / l) * o.speed - o.vx) * k; o.vy += ((dy / l) * o.speed - o.vy) * k; o.vz += ((dz / l) * o.speed - o.vz) * k;
      }
      const sp = Math.hypot(o.vx, o.vy, o.vz) || 1;
      const wall = c.physics.raycast(o.x, o.y, o.z, o.vx / sp, o.vy / sp, o.vz / sp, sp * dt + 0.25, Q_WORLD);
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      o.m.position.set(o.x, o.y, o.z);
      const pulse = 1 + Math.sin(o.life * 20) * 0.12;
      o.m.scale.setScalar(pulse);
      if (Math.random() < dt * 40) c.particles.emit({ n: 1, x: o.x, y: o.y, z: o.z, spread: 0.2, life: 0.4, size: 0.24, sizeEnd: 0.02, color: o.color });
      let done = !!wall || o.life <= 0;
      const dx = px - o.x, dy = py - o.y, dz = pz - o.z;
      if (!done && dx * dx + dz * dz < 0.75 * 0.75 && Math.abs(dy) < 1.15) {
        if (pl.takeDamage(o.dmg, o.x - o.vx, o.z - o.vz, 5)) done = true;
        else if (!pl.alive) done = true;
      }
      if (done) {
        o.on = false; o.m.visible = false;
        c.fx.burst(o.x, o.y, o.z, 0.2, 1.1, 0.2, o.color, 0.8);
        c.particles.emit({ n: 8, x: o.x, y: o.y, z: o.z, speed: 4, life: 0.35, size: 0.18, color: 0xffffff, color2: o.color });
      }
    }
    // ---- 冲击波
    for (const w of this.waves) {
      if (!w.on) continue;
      w.r += w.speed * dt;
      const k = w.r / w.maxR;
      w.m.position.set(w.x, w.y + 0.25, w.z);
      w.m.scale.set(w.r, 1 + (1 - k) * 2.5, w.r);
      if (Math.random() < dt * 60) {
        const a = Math.random() * Math.PI * 2;
        c.particles.emit({ n: 1, x: w.x + Math.cos(a) * w.r, y: w.y + 0.2, z: w.z + Math.sin(a) * w.r, vy: 2.5, speed: 1, life: 0.5, size: 0.24, color: 0xffc080, color2: 0xff5020 });
      }
      if (!w.hit) {
        const d = Math.hypot(px - w.x, pz - w.z);
        if (Math.abs(d - w.r) < 0.75 && pl.pos.y - w.y < 0.75 && pl.pos.y - w.y > -1.5) {
          w.hit = true; // 无敌帧躲过也算已判定，避免闪避后被同一圈再次命中
          pl.takeDamage(w.dmg, w.x, w.z, 9);
        }
      }
      if (w.r >= w.maxR) { w.on = false; w.m.visible = false; }
    }
    // ---- 落雷
    for (const s of this.strikes) {
      if (!s.on) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      s.on = false;
      c.fx.pillar(s.x, s.y, s.z, s.r * 0.75, 26, 0.45, s.color);
      c.fx.ring(s.x, s.y + 0.2, s.z, s.r * 0.4, s.r * 1.5, 0.4, s.color);
      c.particles.emit({ n: 24, x: s.x, y: s.y + 0.4, z: s.z, speed: 9, vy: 5, life: 0.5, size: 0.24, color: 0xffffff, color2: s.color, gravity: 14 });
      const d = Math.hypot(px - s.x, pz - s.z);
      if (d < 60) { c.audio.play('thunder', Math.max(0.25, 1 - d / 40)); c.cam.shake(Math.max(0, 0.45 - d * 0.02)); }
      if (d < s.r + 0.2 && Math.abs(pl.pos.y - s.y) < 3.5) pl.takeDamage(s.dmg, s.x, s.z, 8);
    }
  }

  clear() {
    for (const b of this.blades) { b.on = false; b.m.visible = false; }
    for (const o of this.orbs) { o.on = false; o.m.visible = false; }
    for (const w of this.waves) { w.on = false; w.m.visible = false; }
    for (const s of this.strikes) s.on = false;
  }
  dispose() {
    for (const l of [this.blades, this.orbs, this.waves]) for (const k of l) this.ctx.scene.remove(k.m);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
