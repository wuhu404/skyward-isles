/**
 * 关卡交互物：检查点、能力祭坛、宝箱、拾取物、推箱 / 压板 / 闸门、符文柱谜题、
 * 水晶开关、移动平台、光桥、上升气流、告示牌、陶罐。
 */
import * as THREE from 'three';
import type { Ctx, Hittable, HitInfo } from '../core/Context';
import type { AbilityId } from '../core/Save';
import { RAPIER, CG_WORLD } from '../core/Physics';
import { MeshBuilder } from '../gfx/geo';
import { clamp01, damp, easeInOut, easeOutBack, TAU } from '../core/math';

export abstract class Thing {
  pos = new THREE.Vector3();
  constructor(protected ctx: Ctx) {}
  abstract update(dt: number): void;
  /** 玩家在交互范围内时返回提示文本 */
  prompt(): string | null { return null; }
  interact(): void { /* 默认无交互 */ }
  /** 玩家使用“脱离卡死”时调用：把可能被玩坏的机关恢复到可用状态（不改动已完成的进度） */
  unstick(): void { /* 默认无需处理 */ }
  protected near(r: number, dy = 2.5): boolean {
    const p = this.ctx.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    return dx * dx + dz * dz < r * r && Math.abs(p.y - this.pos.y) < dy;
  }
  protected mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    this.ctx.world.root.add(m);
    return m;
  }
}

export type LootKind = 'shard' | 'heart' | 'dew' | 'potion' | 'relic' | 'health';

// ---------------------------------------------------------------- 检查点
export class Checkpoint extends Thing {
  private crystal: THREE.Mesh;
  private active: boolean;
  private t = 0;
  constructor(ctx: Ctx, readonly id: string, readonly name: string, x: number, y: number, z: number, readonly facing: number) {
    super(ctx);
    this.pos.set(x, y, z);
    const w = ctx.world;
    const base = this.mesh(w.geo('cp_base', () => {
      const b = new MeshBuilder(0.05, 3);
      b.cyl(1.5, 1.7, 0.3, 8, 0x8f8f9a, 0, 0.15, 0, 0, 0, 0, 0xb4b4c0);
      b.cyl(1.0, 1.2, 0.3, 8, 0xa4a4b0, 0, 0.45, 0);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; b.box(0.3, 1.5, 0.3, 0x9a9aa6, Math.cos(a) * 1.25, 0.9, Math.sin(a) * 1.25, 0, -a, 0.12, 0xc4c4d0); }
      return b.build();
    }), ctx.mats.world);
    base.position.copy(this.pos);
    this.active = ctx.hasFlag(id);
    this.crystal = this.mesh(w.geo('cp_crystal', () => { const g = new THREE.OctahedronGeometry(0.42, 0); g.scale(1, 1.7, 1); return g; }),
      this.active ? ctx.mats.glow(0x6ff2ff, 2.6, 0x2a8a9a) : ctx.mats.glow(0x44556a, 0.25, 0x556070), false);
    ctx.physics.staticCylinder(x, y + 0.3, z, 0.3, 1.1);
    w.checkpoints.set(id, { x: x + Math.sin(facing) * 2.4, y: y + 0.3, z: z + Math.cos(facing) * 2.4, facing, name });
  }
  private activate(silent = false) {
    const c = this.ctx;
    this.active = true;
    this.crystal.material = c.mats.glow(0x6ff2ff, 2.6, 0x2a8a9a);
    c.setFlag(this.id);
    c.setCheckpoint(this.id);
    if (!silent) {
      c.audio.play('shrine');
      c.fx.pillar(this.pos.x, this.pos.y, this.pos.z, 1.3, 9, 1.1, 0x7ff5ff);
      c.fx.ring(this.pos.x, this.pos.y + 0.3, this.pos.z, 0.5, 6, 0.8, 0x7ff5ff);
      c.particles.emit({ n: 40, x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, spread: 1, vy: 4, speed: 2, life: 1.3, size: 0.22, color: 0xaafaff, color2: 0x3fb0ff });
      c.ui.banner('风之碑已唤醒', this.name);
    }
  }
  update(dt: number) {
    this.t += dt;
    this.crystal.position.set(this.pos.x, this.pos.y + 1.9 + Math.sin(this.t * 1.6) * 0.14, this.pos.z);
    this.crystal.rotation.y += dt * (this.active ? 1.4 : 0.3);
    if (!this.active && this.near(4.2) && this.ctx.player.alive) { this.activate(); this.rest(false); }
    if (this.active && Math.random() < dt * 5 && this.near(40, 30)) {
      this.ctx.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z, spread: 1.2, vy: 1.2, life: 1.6, size: 0.13, color: 0x9ff8ff, alpha: 0.8 });
    }
  }
  prompt() { return this.active && this.near(3.4) ? '在风之碑休息（恢复并存档）' : null; }
  private rest(fx = true) {
    const c = this.ctx;
    c.player.hp = c.player.maxHp;
    c.player.potions = c.save.potionsMax;
    c.setCheckpoint(this.id);
    c.saveGame();
    if (fx) {
      c.audio.play('heal');
      c.fx.pillar(this.pos.x, this.pos.y, this.pos.z, 1.2, 6, 0.8, 0x7ff5ff);
      c.ui.toast('已休息：生命与药水恢复，进度已保存', 'good');
    }
  }
  interact() { this.rest(); }
}

// ---------------------------------------------------------------- 能力祭坛
const ABILITY_COLOR: Record<AbilityId, number> = { doubleJump: 0x8ff5ff, windBlade: 0x9dffb0, glide: 0xc9a8ff };
export class Shrine extends Thing {
  private orb: THREE.Mesh;
  private ring: THREE.Mesh;
  private t = 0;
  private taken: boolean;
  constructor(ctx: Ctx, readonly ability: AbilityId, x: number, y: number, z: number) {
    super(ctx);
    this.pos.set(x, y, z);
    const w = ctx.world;
    const color = ABILITY_COLOR[ability];
    const base = this.mesh(w.geo('shrine_base', () => {
      const b = new MeshBuilder(0.05, 9);
      b.cyl(2.6, 2.9, 0.35, 10, 0xb8b0a0, 0, 0.17, 0, 0, 0, 0, 0xd8d0c0);
      b.cyl(1.9, 2.2, 0.35, 10, 0xc8c0b0, 0, 0.52, 0);
      b.cyl(0.55, 0.8, 1.1, 6, 0xd8d0c0, 0, 1.25, 0, 0, 0, 0, 0xf0e8d8);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; b.box(0.4, 2.6 + (i % 2) * 0.8, 0.4, 0xc0b8a8, Math.cos(a) * 2.3, 1.6, Math.sin(a) * 2.3, 0, -a, 0, 0xe8e0d0); }
      return b.build();
    }), ctx.mats.world);
    base.position.copy(this.pos);
    this.taken = ctx.save.abilities[ability];
    this.orb = this.mesh(w.geo('shrine_orb', () => new THREE.IcosahedronGeometry(0.45, 1)), ctx.mats.glow(color, 3, 0xffffff), false);
    this.ring = this.mesh(w.geo('shrine_ring', () => new THREE.TorusGeometry(0.8, 0.04, 4, 20)), ctx.mats.glow(color, 2, 0xffffff), false);
    this.orb.visible = this.ring.visible = !this.taken;
    ctx.physics.staticCylinder(x, y + 0.9, z, 0.9, 0.75);
    ctx.physics.staticCylinder(x, y + 0.35, z, 0.35, 2.2);
  }
  update(dt: number) {
    if (this.taken) return;
    this.t += dt;
    const y = this.pos.y + 2.8 + Math.sin(this.t * 1.8) * 0.15;
    this.orb.position.set(this.pos.x, y, this.pos.z);
    this.orb.rotation.y += dt;
    this.ring.position.copy(this.orb.position);
    this.ring.rotation.set(this.t * 0.9, this.t * 1.3, 0);
    if (Math.random() < dt * 12 && this.near(50, 30)) {
      this.ctx.particles.emit({ n: 1, x: this.pos.x, y: y - 0.5, z: this.pos.z, spread: 1.6, vy: 1.5, life: 1.2, size: 0.15, color: ABILITY_COLOR[this.ability] });
    }
  }
  prompt() { return !this.taken && this.near(4) ? '领受风之祝福' : null; }
  interact() {
    const c = this.ctx;
    this.taken = true;
    this.orb.visible = this.ring.visible = false;
    const col = ABILITY_COLOR[this.ability];
    c.fx.pillar(this.pos.x, this.pos.y, this.pos.z, 2.2, 14, 1.6, col);
    c.fx.ring(this.pos.x, this.pos.y + 0.6, this.pos.z, 0.5, 9, 1.0, col);
    c.particles.emit({ n: 70, x: this.pos.x, y: this.pos.y + 2.6, z: this.pos.z, speed: 7, life: 1.4, size: 0.26, color: 0xffffff, color2: col, gravity: -2, drag: 1.5 });
    c.cam.shake(0.4);
    c.unlockAbility(this.ability);
  }
}

// ---------------------------------------------------------------- 宝箱
export class Chest extends Thing {
  private lid: THREE.Mesh;
  private opened: boolean;
  private openT = 0;
  constructor(ctx: Ctx, readonly id: string, x: number, y: number, z: number, rotY: number, private loot: LootKind, private amount = 1) {
    super(ctx);
    this.pos.set(x, y, z);
    const w = ctx.world;
    const base = this.mesh(w.geo('chest_base', () => {
      const b = new MeshBuilder(0.04, 4);
      b.box(1.3, 0.7, 0.9, 0x8a5a30, 0, 0.35, 0, 0, 0, 0, 0xa87040);
      b.box(1.36, 0.12, 0.96, 0xe0b040, 0, 0.66, 0);
      b.box(0.14, 0.72, 0.96, 0xe0b040, -0.5, 0.36, 0); b.box(0.14, 0.72, 0.96, 0xe0b040, 0.5, 0.36, 0);
      return b.build();
    }), ctx.mats.world);
    base.position.copy(this.pos); base.rotation.y = rotY;
    this.lid = this.mesh(w.geo('chest_lid', () => {
      const b = new MeshBuilder(0.04, 5);
      b.box(1.34, 0.36, 0.94, 0x9a6636, 0, 0.18, 0.47, 0, 0, 0, 0xb87c44);
      b.box(0.14, 0.4, 0.98, 0xe0b040, -0.5, 0.2, 0.47); b.box(0.14, 0.4, 0.98, 0xe0b040, 0.5, 0.2, 0.47);
      b.box(0.22, 0.26, 0.1, 0xf8d860, 0, 0.06, 0.96);
      return b.build();
    }), ctx.mats.world);
    this.lid.rotation.order = 'YXZ';
    this.lid.position.set(x - Math.sin(rotY) * 0.47, y + 0.72, z - Math.cos(rotY) * 0.47);
    this.lid.rotation.y = rotY;
    this.opened = ctx.isCollected(id);
    if (this.opened) { this.openT = 1; this.lid.rotation.x = -1.9; }
    ctx.physics.staticBox(x, y + 0.4, z, 0.65, 0.4, 0.45, rotY);
  }
  update(dt: number) {
    if (this.opened && this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt * 2.2);
      this.lid.rotation.x = -1.9 * easeOutBack(this.openT);
    }
  }
  prompt() { return !this.opened && this.near(2.6) ? '打开宝箱' : null; }
  interact() {
    const c = this.ctx;
    this.opened = true;
    c.collect(this.id);
    c.audio.play('chest');
    c.particles.emit({ n: 30, x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z, vy: 4, speed: 2.5, life: 1.0, size: 0.2, color: 0xfff0a0, color2: 0xffa030, gravity: 5 });
    c.fx.pillar(this.pos.x, this.pos.y, this.pos.z, 0.7, 4, 0.7, 0xffe080);
    c.world.grant(this.loot, this.amount, this.id);
    c.saveGame();
  }
}

// ---------------------------------------------------------------- 拾取物
const PICKUP_COLOR: Record<LootKind, number> = { shard: 0x6ff2ff, heart: 0xff5a6a, dew: 0x7dffa0, potion: 0xff9ad0, relic: 0xffd060, health: 0x8dff9a };
export class Pickup extends Thing {
  private m: THREE.Mesh;
  private t = Math.random() * 10;
  active = true;
  private baseY: number;
  private vel = new THREE.Vector3();
  constructor(ctx: Ctx, readonly id: string | null, readonly kind: LootKind, x: number, y: number, z: number, private amount = 1) {
    super(ctx);
    this.pos.set(x, y, z);
    this.baseY = y;
    const w = ctx.world;
    const col = PICKUP_COLOR[kind];
    const geo = w.geo('pk_' + kind, () => {
      switch (kind) {
        case 'shard': { const g = new THREE.OctahedronGeometry(0.2, 0); g.scale(1, 1.7, 1); return g; }
        case 'health': return new THREE.IcosahedronGeometry(0.2, 0);
        case 'relic': { const b = new MeshBuilder(0, 1); b.add(new THREE.TorusGeometry(0.34, 0.07, 4, 6), 0xffffff); b.add(new THREE.OctahedronGeometry(0.2, 0), 0xffffff); return b.build(); }
        case 'heart': { const b = new MeshBuilder(0, 1); b.ico(0.22, 0, 0xffffff, -0.13, 0.1, 0); b.ico(0.22, 0, 0xffffff, 0.13, 0.1, 0); b.cone(0.3, 0.42, 4, 0xffffff, 0, -0.17, 0, Math.PI, 0, 0); return b.build(); }
        default: { const b = new MeshBuilder(0, 1); b.ico(0.24, 1, 0xffffff, 0, 0, 0, 1, 1.25, 1); b.cone(0.1, 0.25, 5, 0xffffff, 0, 0.36, 0); return b.build(); }
      }
    });
    this.m = this.mesh(geo, ctx.mats.glow(col, kind === 'relic' ? 2.6 : 2.0, kind === 'shard' || kind === 'health' ? 0xffffff : col), false);
    this.m.position.copy(this.pos);
    if (id && ctx.isCollected(id)) this.setActive(false);
  }
  setActive(a: boolean) { this.active = a; this.m.visible = a; }
  /** 作为掉落物重新启用（对象池） */
  drop(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.baseY = y;
    this.vel.set((Math.random() - 0.5) * 3, 5, (Math.random() - 0.5) * 3);
    this.t = 0;
    this.setActive(true);
  }
  update(dt: number) {
    if (!this.active) return;
    const c = this.ctx;
    this.t += dt;
    const p = c.player.pos;
    const dx = p.x - this.pos.x, dy = p.y + 0.9 - this.pos.y, dz = p.z - this.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 110 * 110) { this.m.visible = false; return; }
    this.m.visible = true;
    // 掉落物的小抛物线
    if (this.vel.y !== 0 || this.pos.y > this.baseY) {
      this.vel.y -= 16 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= this.baseY) { this.pos.y = this.baseY; this.vel.set(0, 0, 0); }
    }
    const magnet = this.kind === 'shard' || this.kind === 'health' ? 3.6 : 0;
    if (magnet && d2 < magnet * magnet && c.player.alive && this.t > 0.35) {
      const d = Math.sqrt(d2) || 1;
      const sp = 14 * dt / d;
      this.pos.x += dx * sp; this.pos.y += dy * sp; this.pos.z += dz * sp;
      this.baseY = this.pos.y;
    }
    this.m.position.set(this.pos.x, this.pos.y + Math.sin(this.t * 2.4) * 0.12, this.pos.z);
    this.m.rotation.y = this.t * (this.kind === 'relic' ? 2.2 : 1.6);
    if (this.kind === 'relic') {
      this.m.rotation.x = Math.sin(this.t) * 0.4;
      if (Math.random() < dt * 8) c.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y, z: this.pos.z, spread: 0.5, vy: 1, life: 1, size: 0.12, color: 0xffe9a0 });
    }
    if (d2 < 1.25 * 1.25 && c.player.alive) {
      this.setActive(false);
      c.particles.emit({ n: this.kind === 'shard' ? 8 : 20, x: this.pos.x, y: this.pos.y, z: this.pos.z, speed: 3.5, life: 0.5, size: 0.18, color: 0xffffff, color2: PICKUP_COLOR[this.kind] });
      c.audio.play(this.kind === 'relic' ? 'relic' : this.kind === 'health' ? 'heal' : 'pickup', this.kind === 'shard' ? 0.7 : 1);
      if (this.id) c.collect(this.id);
      c.world.grant(this.kind, this.amount, this.id);
      if (this.id && this.kind !== 'shard') c.saveGame();
    }
  }
}

// ---------------------------------------------------------------- 推箱 / 压板 / 闸门
export class PushBlock extends Thing {
  body: RAPIER.RigidBody;
  private m: THREE.Mesh;
  private home = new THREE.Vector3();
  constructor(ctx: Ctx, x: number, y: number, z: number, readonly half = 0.8) {
    super(ctx);
    this.home.set(x, y + half + 0.05, z);
    this.pos.copy(this.home);
    const { body } = ctx.physics.dynamicBox(x, y + half + 0.05, z, half, 1.4);
    this.body = body;
    this.m = this.mesh(ctx.world.geo('pushblock', () => {
      const b = new MeshBuilder(0.05, 6);
      const s = half * 2;
      b.box(s, s, s, 0xb8a888, 0, 0, 0, 0, 0, 0, 0xd8c8a8);
      for (const k of [-1, 1]) { b.box(s * 1.03, s * 0.14, s * 1.03, 0x6a8a9a, 0, k * half * 0.78, 0); }
      return b.build();
    }), ctx.mats.world);
    const g = this.mesh(ctx.world.geo('pushblock_glyph', () => {
      const b = new MeshBuilder(0, 1);
      const s = half * 2;
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; b.add(new THREE.OctahedronGeometry(0.2, 0), 0xffffff, new THREE.Matrix4().makeTranslation(Math.sin(a) * (s / 2 + 0.01), 0, Math.cos(a) * (s / 2 + 0.01))); }
      return b.build();
    }), ctx.mats.glow(0x6ff2ff, 1.6), false);
    this.m.add(g);
  }
  place(x: number, y: number, z: number) {
    this.body.setTranslation({ x, y: y + this.half + 0.05, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  /** 石块被推进死角时无法再推到压板上：回到初始位置 */
  unstick() {
    this.body.setTranslation(this.home, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(this.home);
  }
  update(_dt: number) {
    const t = this.body.translation();
    this.pos.set(t.x, t.y, t.z);
    if (t.y < this.home.y - 9) {
      this.unstick();
      this.ctx.fx.pillar(this.home.x, this.home.y - this.half, this.home.z, 1, 4, 0.6, 0x7ff5ff);
      this.ctx.ui.toast('石块回到了原位');
    }
    this.m.position.copy(this.pos);
    const r = this.body.rotation();
    this.m.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

export class PressurePlate extends Thing {
  private m: THREE.Mesh;
  private pressed = false;
  private latched: boolean;
  constructor(ctx: Ctx, readonly flag: string, x: number, y: number, z: number, private blocks: PushBlock[], private solvedText: string) {
    super(ctx);
    this.pos.set(x, y, z);
    const base = this.mesh(ctx.world.geo('plate_base', () => {
      const b = new MeshBuilder(0.04, 2);
      b.box(3.0, 0.16, 3.0, 0x8a8a94, 0, 0.04, 0, 0, 0, 0, 0xa8a8b4);
      return b.build();
    }), ctx.mats.world);
    base.position.copy(this.pos);
    this.m = this.mesh(ctx.world.geo('plate_top', () => new THREE.BoxGeometry(2.3, 0.14, 2.3)), ctx.mats.glow(0xffb040, 0.9, 0x6a5030));
    this.m.position.set(x, y + 0.18, z);
    this.latched = ctx.hasFlag(flag);
    if (this.latched && blocks[0]) blocks[0].place(x, y + 0.2, z);
  }
  update(dt: number) {
    const c = this.ctx;
    let block = false;
    for (const b of this.blocks) {
      if (Math.abs(b.pos.x - this.pos.x) < 1.25 && Math.abs(b.pos.z - this.pos.z) < 1.25 && Math.abs(b.pos.y - this.pos.y) < 2) block = true;
    }
    const pl = c.player.pos;
    const player = Math.abs(pl.x - this.pos.x) < 1.2 && Math.abs(pl.z - this.pos.z) < 1.2 && Math.abs(pl.y - this.pos.y) < 0.8 && c.player.grounded;
    const now = block || player;
    if (now && !this.pressed) c.audio.play('plate');
    this.pressed = now;
    if (now || this.latched) c.world.signals.add(this.flag);
    if (block && !this.latched) {
      this.latched = true;
      c.setFlag(this.flag);
      c.audio.play('puzzle');
      c.ui.banner('机关已解开', this.solvedText);
      c.fx.ring(this.pos.x, this.pos.y + 0.3, this.pos.z, 0.5, 5, 0.7, 0xffc060);
      c.saveGame();
    }
    this.m.position.y = damp(this.m.position.y, this.pos.y + (now ? 0.08 : 0.18), 14, dt);
    this.m.material = now || this.latched ? c.mats.glow(0x7dffa0, 2.2, 0x306a40) : c.mats.glow(0xffb040, 0.9, 0x6a5030);
  }
}

export class Gate extends Thing {
  private body: RAPIER.RigidBody;
  private m: THREE.Mesh;
  private open = 0;
  private wasOpen = false;
  constructor(ctx: Ctx, readonly flag: string, x: number, y: number, z: number, private w: number, private h: number, rotY = 0) {
    super(ctx);
    this.pos.set(x, y, z);
    const { body } = ctx.physics.kinematicBox(x, y + h / 2, z, w / 2, h / 2, 0.3, rotY);
    this.body = body;
    const b = new MeshBuilder(0.03, 8);
    const n = Math.max(3, Math.round(w / 0.7));
    for (let i = 0; i <= n; i++) b.cyl(0.09, 0.09, h, 5, 0x3a4a5a, -w / 2 + (i / n) * w, 0, 0);
    b.box(w + 0.2, 0.22, 0.26, 0x55687a, 0, h / 2 - 0.15, 0);
    b.box(w + 0.2, 0.22, 0.26, 0x55687a, 0, -h / 2 + 0.4, 0);
    b.box(w + 0.2, 0.16, 0.22, 0x55687a, 0, 0, 0);
    this.m = this.mesh(ctx.world.own(b.build()), ctx.mats.metal);
    this.m.rotation.y = rotY;
    if (ctx.hasFlag(flag)) { this.open = 1; this.wasOpen = true; }
    this.apply();
  }
  private apply() {
    const y = this.pos.y + this.h / 2 - easeInOut(this.open) * (this.h + 0.3);
    this.m.position.set(this.pos.x, y, this.pos.z);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y, z: this.pos.z });
  }
  update(dt: number) {
    const want = this.ctx.hasFlag(this.flag) || this.ctx.world.signals.has(this.flag);
    if (want !== this.wasOpen) { this.wasOpen = want; if (this.near(60, 30)) this.ctx.audio.play('slam', 0.35); }
    const t = clamp01(this.open + (want ? dt : -dt) * 1.4);
    if (t !== this.open) { this.open = t; this.apply(); }
  }
}

// ---------------------------------------------------------------- 符文柱谜题（按顺序击打）
class RunePillar implements Hittable {
  hitPos = new THREE.Vector3();
  hitRadius = 0.9;
  hitHeight = 3;
  aimable = true;
  lit = false;
  gem: THREE.Mesh;
  constructor(readonly owner: RunePuzzle, readonly index: number, readonly color: number, x: number, y: number, z: number) {
    this.hitPos.set(x, y + 1.2, z);
    const ctx = owner.c;
    const m = new THREE.Mesh(ctx.world.geo('rune_pillar', () => {
      const b = new MeshBuilder(0.05, 12);
      b.cyl(0.75, 0.95, 0.4, 6, 0xa89878, 0, 0.2, 0);
      b.cyl(0.5, 0.62, 2.2, 6, 0xcbbd9c, 0, 1.5, 0, 0, 0, 0, 0xe8dcc0);
      b.cyl(0.8, 0.55, 0.3, 6, 0xa89878, 0, 2.75, 0);
      return b.build();
    }), ctx.mats.world);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    ctx.world.root.add(m);
    this.gem = new THREE.Mesh(ctx.world.geo('rune_gem', () => { const g = new THREE.OctahedronGeometry(0.42, 0); g.scale(1, 1.5, 1); return g; }), ctx.mats.glow(color, 0.35, 0x222222));
    this.gem.position.set(x, y + 3.6, z);
    ctx.world.root.add(this.gem);
    ctx.physics.staticCylinder(x, y + 1.45, z, 1.45, 0.65);
  }
  setLit(v: boolean) {
    this.lit = v;
    this.gem.material = this.owner.c.mats.glow(this.color, v ? 3.2 : 0.35, v ? 0xffffff : 0x222222);
  }
  canBeHit() { return !this.owner.solved && !this.lit; }
  onHit(_h: HitInfo) { this.owner.struck(this); return true; }
}
export class RunePuzzle extends Thing {
  solved: boolean;
  private pillars: RunePillar[] = [];
  private progress = 0;
  private t = 0;
  get c() { return this.ctx; }
  /** defs 的顺序即正确击打顺序 */
  constructor(ctx: Ctx, readonly flag: string, defs: { x: number; y: number; z: number; color: number }[], private solvedText: string) {
    super(ctx);
    this.solved = ctx.hasFlag(flag);
    defs.forEach((d, i) => {
      const p = new RunePillar(this, i, d.color, d.x, d.y, d.z);
      this.pillars.push(p);
      ctx.world.hittables.push(p);
      if (this.solved) p.setLit(true);
    });
    this.pos.set(defs[0].x, defs[0].y, defs[0].z);
  }
  struck(p: RunePillar) {
    const c = this.ctx;
    if (p.index === this.progress) {
      p.setLit(true);
      this.progress++;
      c.audio.play('pickup', 1);
      c.fx.ring(p.hitPos.x, p.hitPos.y + 2.4, p.hitPos.z, 0.3, 2.5, 0.5, p.color);
      c.particles.emit({ n: 20, x: p.hitPos.x, y: p.hitPos.y + 2.4, z: p.hitPos.z, speed: 4, life: 0.7, size: 0.2, color: 0xffffff, color2: p.color });
      if (this.progress >= this.pillars.length) {
        this.solved = true;
        c.setFlag(this.flag);
        c.audio.play('puzzle');
        c.ui.banner('符文共鸣', this.solvedText);
        c.cam.shake(0.3);
        for (const q of this.pillars) c.fx.pillar(q.hitPos.x, q.hitPos.y - 1.2, q.hitPos.z, 0.8, 10, 1.2, q.color);
        c.saveGame();
      }
    } else {
      this.progress = 0;
      for (const q of this.pillars) q.setLit(false);
      c.audio.play('fail');
      c.cam.shake(0.25);
      c.ui.toast('符文熄灭了……顺序似乎不对');
      c.particles.emit({ n: 16, x: p.hitPos.x, y: p.hitPos.y + 2.4, z: p.hitPos.z, speed: 3, life: 0.6, size: 0.2, color: 0xff5544, color2: 0x552222 });
    }
  }
  update(dt: number) {
    this.t += dt;
    for (const p of this.pillars) { p.gem.rotation.y += dt * (p.lit ? 2 : 0.5); p.gem.position.y = p.hitPos.y + 2.4 + Math.sin(this.t * 1.5 + p.index) * 0.1; }
  }
}

// ---------------------------------------------------------------- 水晶开关（可被剑 / 风刃点亮）
class Crystal implements Hittable {
  hitPos = new THREE.Vector3();
  hitRadius = 0.9;
  hitHeight = 2.4;
  aimable = true;
  lit = 0;
  m: THREE.Mesh;
  constructor(readonly owner: CrystalPuzzle, x: number, y: number, z: number, pedestal: number) {
    const ctx = owner.c;
    this.hitPos.set(x, y + pedestal + 1.0, z);
    if (pedestal > 0) {
      const b = new MeshBuilder(0.05, 14);
      b.cyl(0.4, 0.7, pedestal, 6, 0x7f8fb0, 0, pedestal / 2, 0, 0, 0, 0, 0xb4c4e0);
      b.cyl(0.8, 0.5, 0.3, 6, 0x8f9fc0, 0, pedestal, 0);
      const pm = new THREE.Mesh(ctx.world.own(b.build()), ctx.mats.world);
      pm.position.set(x, y, z);
      pm.castShadow = pm.receiveShadow = true;
      ctx.world.root.add(pm);
      ctx.physics.staticCylinder(x, y + pedestal / 2, z, pedestal / 2, 0.6);
    }
    this.m = new THREE.Mesh(ctx.world.geo('sw_crystal', () => { const g = new THREE.OctahedronGeometry(0.6, 0); g.scale(1, 1.7, 1); return g; }), ctx.mats.glow(owner.color, 0.3, 0x333344));
    this.m.position.copy(this.hitPos);
    ctx.world.root.add(this.m);
  }
  canBeHit() { return !this.owner.solved && this.lit <= 0; }
  onHit(_h: HitInfo) { this.owner.struck(this); return true; }
}
export class CrystalPuzzle extends Thing {
  solved: boolean;
  private crystals: Crystal[] = [];
  private t = 0;
  get c() { return this.ctx; }
  constructor(ctx: Ctx, readonly flag: string, defs: { x: number; y: number; z: number; pedestal?: number }[], readonly color: number, private window: number, private solvedText: string) {
    super(ctx);
    this.solved = ctx.hasFlag(flag);
    for (const d of defs) {
      const cr = new Crystal(this, d.x, d.y, d.z, d.pedestal ?? 0);
      this.crystals.push(cr);
      ctx.world.hittables.push(cr);
      if (this.solved) cr.lit = 1e9;
    }
    this.pos.copy(this.crystals[0].hitPos);
    this.refresh();
  }
  private refresh() {
    for (const cr of this.crystals) cr.m.material = this.ctx.mats.glow(this.color, cr.lit > 0 ? 3.4 : 0.3, cr.lit > 0 ? 0xffffff : 0x333344);
  }
  struck(cr: Crystal) {
    const c = this.ctx;
    cr.lit = this.window > 0 ? this.window : 1e9;
    c.audio.play('pickup');
    c.fx.ring(cr.hitPos.x, cr.hitPos.y, cr.hitPos.z, 0.3, 3, 0.5, this.color);
    c.particles.emit({ n: 24, x: cr.hitPos.x, y: cr.hitPos.y, z: cr.hitPos.z, speed: 5, life: 0.7, size: 0.22, color: 0xffffff, color2: this.color });
    const n = this.crystals.filter((k) => k.lit > 0).length;
    if (n >= this.crystals.length) {
      this.solved = true;
      for (const k of this.crystals) k.lit = 1e9;
      c.setFlag(this.flag);
      c.audio.play('puzzle');
      c.ui.banner('水晶共鸣', this.solvedText);
      c.cam.shake(0.3);
      c.saveGame();
    } else if (this.crystals.length > 1) {
      c.ui.toast(`水晶已点亮 ${n}/${this.crystals.length}` + (this.window > 0 ? ' · 光芒会逐渐消散，抓紧时间！' : ''));
    }
    this.refresh();
  }
  update(dt: number) {
    this.t += dt;
    let changed = false;
    for (const cr of this.crystals) {
      cr.m.rotation.y += dt * (cr.lit > 0 ? 2.2 : 0.4);
      cr.m.position.y = cr.hitPos.y + Math.sin(this.t * 1.4 + cr.hitPos.x) * 0.12;
      if (!this.solved && cr.lit > 0) {
        cr.lit -= dt;
        // 即将熄灭时闪烁
        if (cr.lit < 3) cr.m.visible = Math.floor(cr.lit * 8) % 2 === 0 || cr.lit <= 0;
        if (cr.lit <= 0) { changed = true; cr.m.visible = true; this.ctx.audio.play('fail', 0.5); }
      }
    }
    if (changed) this.refresh();
  }
}

// ---------------------------------------------------------------- 移动平台
export class MovingPlatform extends Thing {
  private body: RAPIER.RigidBody;
  private handle: number;
  private m: THREE.Mesh;
  private delta = new THREE.Vector3();
  private t = 0;
  private active: boolean;
  constructor(ctx: Ctx, private flag: string | null, private a: THREE.Vector3, private b: THREE.Vector3, w: number, d: number, private travel = 5, private pause = 1.6) {
    super(ctx);
    this.pos.copy(a);
    const { body, collider } = ctx.physics.kinematicBox(a.x, a.y - 0.3, a.z, w / 2, 0.3, d / 2);
    this.body = body;
    this.handle = collider.handle;
    const mb = new MeshBuilder(0.05, 21);
    mb.box(w, 0.6, d, 0xcbbd9c, 0, -0.3, 0, 0, 0, 0, 0xe8dcc0);
    mb.box(w - 0.6, 0.5, d - 0.6, 0x8a7a60, 0, -0.8, 0);
    mb.cone(Math.min(w, d) * 0.42, 1.6, 5, 0x6a5a48, 0, -1.8, 0, Math.PI, 0, 0);
    this.m = this.mesh(ctx.world.own(mb.build()), ctx.mats.world);
    const gm = new MeshBuilder(0, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gm.box(0.3, 0.14, 0.3, 0xffffff, sx * (w / 2 - 0.35), 0.02, sz * (d / 2 - 0.35));
    gm.add(new THREE.OctahedronGeometry(0.35, 0), 0xffffff, new THREE.Matrix4().makeTranslation(0, -2.8, 0));
    const glow = this.mesh(ctx.world.own(gm.build()), ctx.mats.glow(0x6ff2ff, 2.2), false);
    this.m.add(glow);
    this.m.position.copy(a);
    this.active = !flag || ctx.hasFlag(flag);
    glow.visible = this.active;
    this.glow = glow;
    ctx.world.platforms.set(this.handle, this.delta);
  }
  private glow: THREE.Mesh;
  update(dt: number) {
    if (!this.active) {
      if (this.flag && this.ctx.hasFlag(this.flag)) { this.active = true; this.glow.visible = true; this.t = 0; }
      this.delta.set(0, 0, 0);
      return;
    }
    this.t += dt;
    const cycle = (this.travel + this.pause) * 2;
    const u = this.t % cycle;
    let k: number;
    if (u < this.pause) k = 0;
    else if (u < this.pause + this.travel) k = easeInOut((u - this.pause) / this.travel);
    else if (u < this.pause * 2 + this.travel) k = 1;
    else k = 1 - easeInOut((u - this.pause * 2 - this.travel) / this.travel);
    const nx = this.a.x + (this.b.x - this.a.x) * k, ny = this.a.y + (this.b.y - this.a.y) * k, nz = this.a.z + (this.b.z - this.a.z) * k;
    this.delta.set(nx - this.pos.x, ny - this.pos.y, nz - this.pos.z);
    this.pos.set(nx, ny, nz);
    this.m.position.copy(this.pos);
    this.body.setNextKinematicTranslation({ x: nx, y: ny - 0.3, z: nz });
  }
}

// ---------------------------------------------------------------- 光桥
export class LightBridge extends Thing {
  private tiles: { m: THREE.Mesh; col: RAPIER.Collider; k: number }[] = [];
  private on: boolean;
  private t = 0;
  constructor(ctx: Ctx, private flag: string, pts: THREE.Vector3[], private color = 0x7dffc0) {
    super(ctx);
    this.pos.copy(pts[0]);
    const geo = ctx.world.geo('bridge_tile', () => new THREE.CylinderGeometry(1.75, 1.55, 0.3, 6));
    const mat = ctx.mats.track(new THREE.MeshStandardMaterial({ color: 0x224433, emissive: color, emissiveIntensity: 1.5, transparent: true, opacity: 0.82, flatShading: true }));
    this.on = ctx.hasFlag(flag);
    for (const p of pts) {
      const m = this.mesh(geo, mat, false);
      m.position.set(p.x, p.y - 0.15, p.z);
      const col = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.15, 1.7).setTranslation(p.x, p.y - 0.15, p.z).setCollisionGroups(CG_WORLD));
      col.setEnabled(this.on);
      m.visible = this.on;
      this.tiles.push({ m, col, k: this.on ? 1 : 0 });
    }
  }
  update(dt: number) {
    if (!this.on) {
      if (!this.ctx.hasFlag(this.flag)) return;
      this.on = true;
      this.t = 0;
    }
    this.t += dt;
    for (let i = 0; i < this.tiles.length; i++) {
      const tl = this.tiles[i];
      if (tl.k >= 1) continue;
      if (this.t < i * 0.16) continue;
      if (tl.k === 0) {
        tl.col.setEnabled(true);
        tl.m.visible = true;
        const p = tl.m.position;
        this.ctx.particles.emit({ n: 10, x: p.x, y: p.y, z: p.z, speed: 3, flat: true, life: 0.6, size: 0.2, color: 0xffffff, color2: this.color });
        if (i % 2 === 0) this.ctx.audio.play('pickup', 0.5);
      }
      tl.k = Math.min(1, tl.k + dt * 3);
      tl.m.scale.setScalar(Math.max(0.01, easeOutBack(tl.k)));
    }
  }
}

// ---------------------------------------------------------------- 上升气流
export class Updraft extends Thing {
  private on: boolean;
  private acc = 0;
  constructor(ctx: Ctx, private flag: string | null, x: number, y: number, z: number, readonly radius: number, readonly height: number, readonly strength = 15, private color = 0xbff8ff) {
    super(ctx);
    this.pos.set(x, y, z);
    this.on = !flag || ctx.hasFlag(flag);
    ctx.world.updrafts.push(this);
  }
  /** 返回该位置的目标上升速度（0 表示不在气流内） */
  force(p: THREE.Vector3): number {
    if (!this.on) return 0;
    const dy = p.y - this.pos.y;
    if (dy < -1 || dy > this.height) return 0;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz > this.radius * this.radius) return 0;
    return Math.max(0.6, this.strength * clamp01((this.height - dy) / 5));
  }
  update(dt: number) {
    if (!this.on) {
      if (this.flag && this.ctx.hasFlag(this.flag)) {
        this.on = true;
        this.ctx.fx.pillar(this.pos.x, this.pos.y, this.pos.z, this.radius, this.height, 1.5, this.color);
      }
      return;
    }
    if (!this.near(110, 90)) return;
    this.acc += dt * 46;
    while (this.acc >= 1) {
      this.acc -= 1;
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * this.radius;
      this.ctx.particles.emit({
        n: 1, x: this.pos.x + Math.cos(a) * r, y: this.pos.y + Math.random() * this.height * 0.75, z: this.pos.z + Math.sin(a) * r,
        vx: -Math.sin(a) * 2.2, vz: Math.cos(a) * 2.2, vy: 7 + Math.random() * 6, life: 1.1 + Math.random() * 0.7, size: 0.2, sizeEnd: 0.05, color: this.color, alpha: 0.75,
      });
    }
  }
}

// ---------------------------------------------------------------- 告示牌
export class Sign extends Thing {
  constructor(ctx: Ctx, x: number, y: number, z: number, rotY: number, private text: string) {
    super(ctx);
    this.pos.set(x, y, z);
    const m = this.mesh(ctx.world.geo('sign', () => {
      const b = new MeshBuilder(0.04, 17);
      b.box(0.16, 1.5, 0.16, 0x7a5236, 0, 0.75, 0);
      b.box(1.5, 0.85, 0.1, 0xc9a468, 0, 1.45, 0.06, 0, 0, 0, 0xe0c080);
      for (let i = 0; i < 3; i++) b.box(1.0 - i * 0.22, 0.07, 0.02, 0x6a4a2a, -0.08 * i, 1.65 - i * 0.2, 0.12);
      return b.build();
    }), ctx.mats.world);
    m.position.copy(this.pos);
    m.rotation.y = rotY;
    ctx.physics.staticCylinder(x, y + 0.75, z, 0.75, 0.2);
  }
  update() { /* 静态 */ }
  prompt() { return this.near(2.6) ? '阅读告示' : null; }
  interact() { this.ctx.audio.play('ui'); this.ctx.ui.dialog(this.text, 8); }
}

// ---------------------------------------------------------------- 陶罐（可击碎）
export class Pot extends Thing implements Hittable {
  hitPos = new THREE.Vector3();
  hitRadius = 0.55;
  hitHeight = 1.2;
  aimable = false;
  private m: THREE.Mesh;
  private col: RAPIER.Collider;
  private broken = false;
  constructor(ctx: Ctx, x: number, y: number, z: number, private color = 0xc87850) {
    super(ctx);
    this.pos.set(x, y, z);
    this.hitPos.set(x, y + 0.5, z);
    this.m = this.mesh(ctx.world.geo('pot' + color, () => {
      const b = new MeshBuilder(0.05, 23);
      b.cyl(0.42, 0.28, 0.6, 7, color, 0, 0.3, 0, 0, 0, 0, 0xf0c090);
      b.cyl(0.26, 0.42, 0.3, 7, color, 0, 0.75, 0);
      b.cyl(0.32, 0.26, 0.1, 7, 0x6a4030, 0, 0.94, 0);
      return b.build();
    }), ctx.mats.world);
    this.m.position.copy(this.pos);
    this.col = ctx.physics.staticCylinder(x, y + 0.5, z, 0.5, 0.4);
    ctx.world.hittables.push(this);
  }
  canBeHit() { return !this.broken; }
  onHit(_h: HitInfo) {
    const c = this.ctx;
    this.broken = true;
    this.m.visible = false;
    this.col.setEnabled(false);
    c.audio.play('break');
    c.particles.emit({ n: 16, x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z, speed: 5, vy: 2, life: 0.7, size: 0.26, color: this.color, color2: 0x6a4030, gravity: 16, additive: false });
    if (Math.random() < 0.6) c.world.spawnDrop(this.pos.x, this.pos.y + 0.6, this.pos.z);
    return true;
  }
  reset() { this.broken = false; this.m.visible = true; this.col.setEnabled(true); }
  update() { /* 静态 */ }
}

// ---------------------------------------------------------------- 旋转部件（风车叶片等）
export class Spinner extends Thing {
  constructor(ctx: Ctx, private m: THREE.Mesh, private speed: number) { super(ctx); this.pos.copy(m.position); }
  update(dt: number) { this.m.rotateZ(this.speed * dt); }
}
