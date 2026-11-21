/**
 * 世界容器：岛屿、静态道具批次、交互物、敌人，以及供玩家 / 敌人使用的空间查询。
 */
import * as THREE from 'three';
import type { Ctx, Hittable } from '../core/Context';
import type { ZoneId } from '../gfx/Sky';
import { MeshBuilder } from '../gfx/geo';
import { makeRng, TAU } from '../core/math';
import { Island, type IslandOpts } from './Island';
import { grassMaterial, grassTuftGeo, type PropCtx } from './Props';
import { Pickup, Pot, type LootKind, type Thing, type Updraft } from './Interactables';

export interface EnemyLike {
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
  /** 是否参与与玩家的软推挤 */
  solid: boolean;
  update(dt: number): void;
  /** 玩家死亡 / 读档后重置 */
  respawn(): void;
  dispose(): void;
}
export interface BossLike extends EnemyLike { started: boolean; defeated: boolean; }

export const WEAPON_THRESHOLDS = [12, 30, 55];
export const WEAPON_NAMES = ['旅人之剑', '清风之剑', '流云之剑', '苍穹之剑'];
export const weaponLevelFor = (shards: number) => WEAPON_THRESHOLDS.filter((t) => shards >= t).length;
export const ZONE_NAMES: Record<ZoneId, [string, string]> = {
  meadow: ['启程草原', '风与草的故乡'],
  ruins: ['落日遗迹', '沉睡的黄金古城'],
  frost: ['霜晶极境', '极光之下的冰原'],
  storm: ['风暴祭坛', '苍穹守卫的王座'],
};

export class World {
  root = new THREE.Group();
  islands: Island[] = [];
  things: Thing[] = [];
  hittables: Hittable[] = [];
  enemies: EnemyLike[] = [];
  boss: BossLike | null = null;
  pots: Pot[] = [];
  platforms = new Map<number, THREE.Vector3>();
  updrafts: Updraft[] = [];
  /** 本帧有效的临时信号（压板被踩住等） */
  signals = new Set<string>();
  checkpoints = new Map<string, { x: number; y: number; z: number; facing: number; name: string }>();
  totals = { relic: 0, shard: 0 };
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private owned: THREE.BufferGeometry[] = [];
  private drops: Pickup[] = [];
  private grassU = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() } };
  private grassMat: THREE.MeshLambertMaterial;
  private grassGeo: THREE.BufferGeometry;
  private glowMat: THREE.MeshBasicMaterial;
  private ambAcc = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(private ctx: Ctx) {
    ctx.scene.add(this.root);
    this.grassMat = grassMaterial(this.grassU);
    this.grassGeo = this.own(grassTuftGeo());
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.9, 1.9, 1.9) });
  }

  /** 必须在关卡搭建完成后调用 */
  finish() {
    for (let i = 0; i < 10; i++) {
      const d = new Pickup(this.ctx, null, 'health', 0, -999, 0);
      d.setActive(false);
      this.drops.push(d);
      this.things.push(d);
    }
  }

  // ------------------------------------------------------------ 资源
  /** 按 key 共享的几何体 */
  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) { g = make(); this.geoCache.set(key, g); }
    return g;
  }
  own<T extends THREE.BufferGeometry>(g: T): T { this.owned.push(g); return g; }

  // ------------------------------------------------------------ 搭建
  addIsland(o: IslandOpts): Island {
    const isl = new Island(o);
    this.islands.push(isl);
    this.own(isl.geometry);
    const m = new THREE.Mesh(isl.geometry, this.ctx.mats.world);
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    this.ctx.physics.staticTrimesh(isl.colVerts, isl.colIdx);
    return isl;
  }
  beginProps(seed: number): PropCtx {
    return { b: new MeshBuilder(0.06, seed), glow: new MeshBuilder(0.05, seed + 1), physics: this.ctx.physics, rng: makeRng(seed) };
  }
  endProps(pc: PropCtx) {
    if (pc.b.triangleCount > 0) {
      const m = new THREE.Mesh(this.own(pc.b.build()), this.ctx.mats.world);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }
    if (pc.glow.triangleCount > 0) this.root.add(new THREE.Mesh(this.own(pc.glow.build()), this.glowMat));
  }
  addGrass(isl: Island, density: number, c1: number, c2: number, seed: number, avoid: [number, number, number][] = [], scale = 1) {
    const rng = makeRng(seed);
    const want = Math.round(Math.PI * isl.r * isl.r * density);
    const pts: number[] = [];
    const paths = isl.o.paths ?? [];
    for (let i = 0; i < want; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * isl.r;
      const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
      if (!isl.contains(x, z, 0.5)) continue;
      let ok = true;
      for (const p of paths) {
        const dx = p[2] - p[0], dz = p[3] - p[1];
        const t = Math.min(1, Math.max(0, ((x - p[0]) * dx + (z - p[1]) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(x - (p[0] + dx * t), z - (p[1] + dz * t)) < p[4] * 0.55) { ok = false; break; }
      }
      if (ok) for (const c of avoid) if (Math.hypot(x - c[0], z - c[1]) < c[2]) { ok = false; break; }
      if (!ok) continue;
      const y = isl.heightAt(x, z);
      if (y === null) continue;
      pts.push(x, y, z);
    }
    const n = pts.length / 3;
    if (!n) return;
    const im = new THREE.InstancedMesh(this.grassGeo, this.grassMat, n);
    const ca = new THREE.Color(c1), cb = new THREE.Color(c2);
    for (let i = 0; i < n; i++) {
      this.dummy.position.set(pts[i * 3], pts[i * 3 + 1] - 0.03, pts[i * 3 + 2]);
      this.dummy.rotation.set(0, rng() * TAU, 0);
      const s = (0.75 + rng() * 0.7) * scale;
      this.dummy.scale.set(s, s * (0.8 + rng() * 0.6), s);
      this.dummy.updateMatrix();
      im.setMatrixAt(i, this.dummy.matrix);
      im.setColorAt(i, this.col.copy(ca).lerp(cb, rng()));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    this.root.add(im);
  }
  add<T extends Thing>(t: T): T { this.things.push(t); return t; }

  // ------------------------------------------------------------ 查询
  /** 岛屿顶面高度；yHint 用于在多层岛屿间选最接近的一层 */
  groundAt(x: number, z: number, yHint?: number): number | null {
    let best: number | null = null;
    for (const isl of this.islands) {
      const dx = x - isl.x, dz = z - isl.z;
      if (dx * dx + dz * dz > isl.r * isl.r) continue;
      const h = isl.heightAt(x, z);
      if (h === null) continue;
      if (best === null || (yHint !== undefined && Math.abs(h - yHint) < Math.abs(best - yHint))) best = h;
    }
    return best;
  }
  updraftAt(p: THREE.Vector3): number {
    let f = 0;
    for (const u of this.updrafts) f = Math.max(f, u.force(p));
    return f;
  }
  platformDelta(handle: number): THREE.Vector3 | undefined { return this.platforms.get(handle); }
  /** 敌人对玩家的软推挤速度 */
  pushOut(pos: THREE.Vector3, radius: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    for (const e of this.enemies) {
      if (!e.alive || !e.solid) continue;
      const dx = pos.x - e.pos.x, dz = pos.z - e.pos.z;
      const rr = radius + e.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || Math.abs(pos.y - e.pos.y) > 2.2) continue;
      const d = Math.sqrt(d2) || 0.001;
      const k = Math.min(7, (rr - d) * 14) / d;
      out.x += dx * k; out.z += dz * k;
    }
    return out;
  }
  zoneAt(z: number): ZoneId {
    return z > -118 ? 'meadow' : z > -222 ? 'ruins' : z > -352 ? 'frost' : 'storm';
  }

  // ------------------------------------------------------------ 奖励 / 掉落
  grant(kind: LootKind, amount: number, _id: string | null) {
    const c = this.ctx, s = c.save, p = c.player;
    switch (kind) {
      case 'shard': {
        const before = weaponLevelFor(s.shards);
        s.shards += amount;
        const after = weaponLevelFor(s.shards);
        if (amount > 1) c.ui.toast(`星辉碎片 +${amount}`, 'item');
        if (after > before) {
          p.weaponLevel = after;
          c.audio.play('ability', 0.7);
          c.ui.banner('武器共鸣', `星辉碎片唤醒了「${WEAPON_NAMES[after]}」 · 攻击力提升`);
          c.fx.pillar(p.pos.x, p.pos.y, p.pos.z, 1, 6, 1, 0xfff0a0);
          c.saveGame();
        }
        break;
      }
      case 'heart': s.maxHp += 20 * amount; p.hp = s.maxHp; c.ui.toast('获得「生命之心」 · 生命上限 +20', 'item'); break;
      case 'dew': s.maxStamina += 20 * amount; p.stamina = s.maxStamina; c.ui.toast('获得「体力之露」 · 体力上限 +20', 'item'); break;
      case 'potion': s.potionsMax += amount; p.potions = s.potionsMax; c.ui.toast('获得「药水瓶」 · 治疗药水上限 +1', 'item'); break;
      case 'relic': {
        const n = s.collected.filter((k) => k.startsWith('relic_')).length;
        c.ui.banner('发现远古遗物', `已收集 ${n} / ${this.totals.relic}`);
        break;
      }
      case 'health': p.heal(16); break;
    }
  }
  spawnDrop(x: number, y: number, z: number) {
    const d = this.drops.find((k) => !k.active);
    if (d) d.drop(x, y, z);
  }

  /** 玩家复活时重置普通敌人与可破坏物 */
  resetEncounters() {
    for (const e of this.enemies) e.respawn();
    for (const p of this.pots) p.reset();
    for (const d of this.drops) d.setActive(false);
  }

  // ------------------------------------------------------------ 更新
  update(dt: number) {
    const c = this.ctx;
    const pp = c.player.pos;
    this.grassU.uTime.value += dt;
    this.grassU.uPlayer.value.copy(pp);
    this.signals.clear();
    for (const t of this.things) t.update(dt);
    for (const e of this.enemies) e.update(dt);

    // 交互提示：取最近的一个
    let best: Thing | null = null, bestD = 1e9, text: string | null = null;
    if (c.player.alive && c.player.frozen <= 0) {
      for (const t of this.things) {
        const p = t.prompt();
        if (!p) continue;
        const d = t.pos.distanceToSquared(pp);
        if (d < bestD) { bestD = d; best = t; text = p; }
      }
    }
    c.ui.setPrompt(text);
    if (best && c.input.wasPressed('interact')) best.interact();

    this.ambient(dt);
  }

  /** 各区域的环境粒子（围绕玩家生成） */
  private ambient(dt: number) {
    const c = this.ctx;
    const p = c.player.pos;
    const zone = this.zoneAt(p.z);
    const rate = zone === 'frost' ? 60 : zone === 'storm' ? 34 : 14;
    this.ambAcc += dt * rate;
    while (this.ambAcc >= 1) {
      this.ambAcc -= 1;
      const x = p.x + (Math.random() - 0.5) * 44, z = p.z + (Math.random() - 0.5) * 44;
      if (zone === 'meadow') c.particles.emit({ n: 1, x, y: p.y + Math.random() * 6, z, vx: 1.2, vy: 0.3, speed: 0.4, life: 5, size: 0.11, color: 0xfff6c0, color2: 0xa8ff90, alpha: 0.7 });
      else if (zone === 'ruins') c.particles.emit({ n: 1, x, y: p.y + Math.random() * 5, z, vx: -0.8, vy: 0.7, speed: 0.5, life: 5, size: 0.1, color: 0xffc070, color2: 0xff7030, alpha: 0.75 });
      else if (zone === 'frost') c.particles.emit({ n: 1, x, y: p.y + 6 + Math.random() * 8, z, vx: 1.5, vy: -2.6, speed: 0.5, life: 5, size: 0.12, color: 0xffffff, alpha: 0.8, additive: false });
      else c.particles.emit({ n: 1, x, y: p.y + Math.random() * 7, z, vx: -3, vy: 2.5, speed: 1.5, life: 2.4, size: 0.12, color: 0xd0a8ff, color2: 0x6030c0, alpha: 0.8 });
    }
  }

  dispose() {
    for (const e of this.enemies) e.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    for (const g of this.owned) g.dispose();
    this.geoCache.clear();
    this.owned = [];
    this.root.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    this.grassMat.dispose();
    this.glowMat.dispose();
    this.root.removeFromParent();
    this.things = [];
    this.hittables = [];
    this.enemies = [];
  }
}
