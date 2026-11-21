/**
 * 敌人基类 + 三种普通敌人：
 *  - Slime 苔灵：跳跃追击 → 蓄力 → 扑击
 *  - Golem 石像卫士：沉睡 → 苏醒 → 砸地冲击波 / 横扫，霸体
 *  - Wisp 幽光灵：悬浮远程，保持距离、蓄力射击、被贴近时闪现
 */
import * as THREE from 'three';
import type { Ctx, Hittable, HitInfo } from '../core/Context';
import type { EnemyLike } from '../world/World';
import { RAPIER, CG_ENEMY } from '../core/Physics';
import { MeshBuilder } from '../gfx/geo';
import { angleDiff, clamp01, damp, dampAngle, TAU, yawOf } from '../core/math';

const barGeo = { g: null as THREE.PlaneGeometry | null };

export abstract class Enemy implements Hittable, EnemyLike {
  pos = new THREE.Vector3();
  home = new THREE.Vector3();
  hitPos = new THREE.Vector3();
  hitRadius = 0.7;
  hitHeight = 1.4;
  aimable = true;
  radius = 0.7;
  alive = true;
  solid = true;
  hp = 1;
  maxHp = 1;
  facing = 0;
  state = 'idle';
  stateT = 0;
  group = new THREE.Group();
  protected mat: THREE.MeshStandardMaterial;
  protected body: RAPIER.RigidBody | null = null;
  protected collider: RAPIER.Collider | null = null;
  protected cc: RAPIER.KinematicCharacterController | null = null;
  protected vy = 0;
  protected grounded = true;
  protected knock = new THREE.Vector3();
  protected flash = 0;
  protected deathT = 0;
  protected aggro = false;
  protected flying = false;
  protected centerY = 0.7;
  private bar: THREE.Sprite;
  private barBg: THREE.Sprite;
  private desired = { x: 0, y: 0, z: 0 };
  protected dropChance = 0.35;
  /** 与玩家的水平距离 / 方向（每帧更新） */
  protected dist = 0;
  protected dx = 0;
  protected dz = 0;

  constructor(protected ctx: Ctx, x: number, y: number, z: number, tint = 0xffffff) {
    this.home.set(x, y, z);
    this.pos.copy(this.home);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, color: tint, emissive: 0xffffff, emissiveIntensity: 0 });
    ctx.world.root.add(this.group);
    const w = ctx.world;
    const bg = w.geo('__bar', () => new THREE.PlaneGeometry(1, 1)); // 仅用于统一释放时机
    void bg; void barGeo;
    this.barBg = new THREE.Sprite(Enemy.barMat(ctx, 0x1a1420));
    this.bar = new THREE.Sprite(Enemy.barMat(ctx, 0xff4a5a));
    this.bar.center.set(0, 0.5);
    this.barBg.center.set(0, 0.5);
    this.bar.visible = this.barBg.visible = false;
    this.bar.renderOrder = 11; this.barBg.renderOrder = 10;
    ctx.world.root.add(this.barBg, this.bar);
  }
  private static mats = new WeakMap<object, Map<number, THREE.SpriteMaterial>>();
  private static barMat(ctx: Ctx, color: number) {
    let m = Enemy.mats.get(ctx.mats);
    if (!m) { m = new Map(); Enemy.mats.set(ctx.mats, m); }
    let s = m.get(color);
    if (!s) { s = ctx.mats.track(new THREE.SpriteMaterial({ color, depthTest: false, fog: false })); m.set(color, s); }
    return s;
  }

  protected initBody(halfH: number, r: number) {
    this.centerY = halfH + r;
    const { body, collider } = this.ctx.physics.capsule(this.pos.x, this.pos.y + this.centerY, this.pos.z, halfH, r, CG_ENEMY);
    this.body = body; this.collider = collider;
    this.cc = this.ctx.physics.controller(0.03, 0.3, 0.3);
  }
  protected part(geoKey: string, make: () => THREE.BufferGeometry, parent: THREE.Object3D = this.group, mat: THREE.Material = this.mat): THREE.Mesh {
    const m = new THREE.Mesh(this.ctx.world.geo(geoKey, make), mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  protected setState(s: string) { this.state = s; this.stateT = 0; }

  canBeHit() { return this.alive; }
  onHit(h: HitInfo): boolean {
    if (!this.alive) return false;
    const c = this.ctx;
    const dmg = this.modifyDamage(h);
    this.hp -= dmg;
    this.flash = 1;
    this.aggro = true;
    c.ui.damageNumber(this.hitPos, dmg, h.heavy ? 'crit' : 'enemy');
    this.knock.set(h.dirX * h.knock * this.knockScale, 0, h.dirZ * h.knock * this.knockScale);
    if (this.hp <= 0) this.die();
    else this.onDamaged(h, dmg);
    return true;
  }
  protected knockScale = 1;
  protected modifyDamage(h: HitInfo) { return h.damage; }
  protected onDamaged(_h: HitInfo, _dmg: number) { /* 子类覆写 */ }
  protected abstract color(): number;

  die() {
    if (!this.alive) return;
    const c = this.ctx;
    this.alive = false;
    this.deathT = 0;
    this.hp = 0;
    this.bar.visible = this.barBg.visible = false;
    c.save.kills++;
    c.audio.play('enemyDie');
    c.particles.emit({ n: 30, x: this.pos.x, y: this.hitPos.y, z: this.pos.z, spread: this.radius * 0.6, speed: 6, vy: 2, life: 0.8, size: 0.3, color: 0xffffff, color2: this.color(), gravity: 6, drag: 1.5 });
    c.fx.burst(this.pos.x, this.hitPos.y, this.pos.z, 0.3, this.radius * 2.6, 0.3, this.color(), 0.7);
    if (Math.random() < this.dropChance) c.world.spawnDrop(this.pos.x, this.hitPos.y, this.pos.z);
    this.collider?.setEnabled(false);
  }
  respawn() {
    this.alive = true;
    this.hp = this.maxHp;
    this.pos.copy(this.home);
    this.vy = 0;
    this.knock.set(0, 0, 0);
    this.aggro = false;
    this.flash = 0;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.bar.visible = this.barBg.visible = false;
    this.collider?.setEnabled(true);
    this.body?.setTranslation({ x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z }, true);
    this.setState('idle');
    this.sync();
  }

  /** 地面单位移动：重力 + Rapier 角色控制器 + 悬崖防护 */
  protected move(vx: number, vz: number, dt: number) {
    const w = this.ctx.world;
    vx += this.knock.x; vz += this.knock.z;
    const sp = Math.hypot(vx, vz);
    if (sp > 0.01 && this.grounded) {
      const look = this.radius + 0.5;
      if (w.groundAt(this.pos.x + (vx / sp) * look, this.pos.z + (vz / sp) * look, this.pos.y) === null) { vx = 0; vz = 0; this.knock.set(0, 0, 0); this.onEdge(); }
    }
    this.vy = this.grounded && this.vy <= 0 ? -2 : this.vy - 28 * dt;
    const d = this.desired;
    d.x = vx * dt; d.y = this.vy * dt; d.z = vz * dt;
    if (this.cc && this.collider && this.body) {
      this.cc.computeColliderMovement(this.collider, d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, CG_ENEMY);
      const m = this.cc.computedMovement();
      this.grounded = this.cc.computedGrounded();
      this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.centerY, z: this.pos.z });
    }
    if (this.pos.y < this.home.y - 18) this.die();
  }
  protected onEdge() { /* 子类可覆写 */ }
  protected jump(v: number) { this.vy = v; this.grounded = false; }
  protected face(dt: number, rate = 8) { this.facing = dampAngle(this.facing, yawOf(this.dx, this.dz), rate, dt); }
  protected hitPlayer(dmg: number, knock = 7) { return this.ctx.player.takeDamage(dmg, this.pos.x, this.pos.z, knock); }
  protected get homeDist() { return Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z); }
  protected get playerHomeDist() { const p = this.ctx.player.pos; return Math.hypot(p.x - this.home.x, p.z - this.home.z); }

  protected sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
    this.hitPos.set(this.pos.x, this.pos.y + (this.flying ? 0 : this.hitHeight * 0.5), this.pos.z);
  }
  protected abstract think(dt: number): void;

  update(dt: number) {
    const c = this.ctx;
    const p = c.player.pos;
    if (!this.alive) {
      if (this.group.visible) {
        this.deathT += dt * 3;
        this.group.scale.setScalar(Math.max(0.001, 1 - this.deathT));
        this.group.position.y += dt * 2;
        if (this.deathT >= 1) this.group.visible = false;
      }
      return;
    }
    this.dx = p.x - this.pos.x; this.dz = p.z - this.pos.z;
    this.dist = Math.hypot(this.dx, this.dz);
    if (this.dist > 75 && !this.aggro) return; // 远处休眠
    this.stateT += dt;
    this.knock.x = damp(this.knock.x, 0, 8, dt);
    this.knock.z = damp(this.knock.z, 0, 8, dt);
    this.think(dt);
    this.sync();
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.emissiveIntensity = this.flash * 0.85;
    // 血条
    const show = this.hp < this.maxHp;
    this.bar.visible = this.barBg.visible = show;
    if (show) {
      const w = Math.min(2.4, 0.9 + this.maxHp / 160);
      const y = this.hitPos.y + this.hitHeight * 0.5 + 0.55;
      // 让血条左端对齐：沿相机右方向偏移半个宽度
      const cam = c.cam.camera;
      const rx = cam.matrixWorld.elements[0], rz = cam.matrixWorld.elements[2];
      this.barBg.position.set(this.pos.x - rx * w * 0.5, y, this.pos.z - rz * w * 0.5);
      this.bar.position.copy(this.barBg.position);
      this.barBg.scale.set(w, 0.13, 1);
      this.bar.scale.set(Math.max(0.001, w * clamp01(this.hp / this.maxHp)), 0.09, 1);
    }
  }

  dispose() {
    this.mat.dispose();
    if (this.cc) this.ctx.physics.world.removeCharacterController(this.cc);
  }
}

// ============================================================ 苔灵
const SLIME_TIERS = [
  { hp: 38, dmg: 11, tint: 0xffffff, color: 0x7be060, speed: 1 },
  { hp: 56, dmg: 15, tint: 0xffc890, color: 0xf0b050, speed: 1.1 },
  { hp: 74, dmg: 19, tint: 0xa8d8ff, color: 0x8fd8ff, speed: 1.2 },
];
export class Slime extends Enemy {
  private bodyM: THREE.Mesh;
  private hopT = 0;
  private wanderA = Math.random() * TAU;
  private lungeX = 0;
  private lungeZ = 0;
  private hitDone = false;
  private sq = 0;
  private cd = Math.random();
  private T;
  constructor(ctx: Ctx, x: number, y: number, z: number, private tier = 0) {
    super(ctx, x, y, z, SLIME_TIERS[tier].tint);
    this.T = SLIME_TIERS[tier];
    this.hp = this.maxHp = this.T.hp;
    this.radius = 0.75; this.hitRadius = 0.8; this.hitHeight = 1.2;
    this.knockScale = 1.1;
    this.bodyM = this.part('slime', () => {
      const b = new MeshBuilder(0.07, 31);
      b.ico(0.78, 1, 0x5fcf4a, 0, 0.56, 0, 1, 0.78, 1, 0, 0x9ff078);
      b.ico(0.4, 0, 0x8fe870, 0.3, 1.0, -0.2);
      b.box(0.16, 0.24, 0.08, 0x18301c, 0.26, 0.66, 0.68); b.box(0.16, 0.24, 0.08, 0x18301c, -0.26, 0.66, 0.68);
      b.box(0.06, 0.08, 0.04, 0xffffff, 0.3, 0.72, 0.73); b.box(0.06, 0.08, 0.04, 0xffffff, -0.22, 0.72, 0.73);
      b.box(0.05, 0.36, 0.05, 0x3a8a34, 0, 1.3, 0); // 小芽
      b.box(0.3, 0.04, 0.16, 0x6fe058, 0.14, 1.46, 0, 0, 0, 0.4); b.box(0.3, 0.04, 0.16, 0x6fe058, -0.14, 1.46, 0, 0, 0, -0.4);
      return b.build();
    });
    this.initBody(0.15, 0.55);
    this.facing = Math.random() * TAU;
    this.sync();
  }
  protected color() { return this.T.color; }
  protected onDamaged() { if (this.state !== 'lunge') this.setState('stagger'); this.sq = 0.5; }
  respawn() { super.respawn(); this.cd = Math.random(); }

  protected think(dt: number) {
    const T = this.T;
    let vx = 0, vz = 0;
    this.cd = Math.max(0, this.cd - dt);
    const canSee = this.dist < 14 && Math.abs(this.ctx.player.pos.y - this.pos.y) < 5 && this.ctx.player.alive;
    switch (this.state) {
      case 'idle': {
        // 闲逛：小跳
        this.hopT += dt;
        if (this.hopT > 1.6 && this.grounded) { this.hopT = 0; this.wanderA += (Math.random() - 0.5) * 2.5; if (this.homeDist > 5) this.wanderA = Math.atan2(this.home.z - this.pos.z, this.home.x - this.pos.x); this.jump(5); this.sq = -0.3; }
        if (!this.grounded) { vx = Math.cos(this.wanderA) * 1.8; vz = Math.sin(this.wanderA) * 1.8; this.facing = dampAngle(this.facing, yawOf(vx, vz), 6, dt); }
        if (canSee || this.aggro) { this.aggro = true; this.setState('chase'); this.ctx.particles.emit({ n: 6, x: this.pos.x, y: this.pos.y + 1.8, z: this.pos.z, speed: 2, life: 0.4, size: 0.2, color: 0xffe060 }); }
        break;
      }
      case 'chase': {
        this.face(dt, 7);
        this.hopT += dt;
        if (this.grounded && this.hopT > 0.38) { this.hopT = 0; this.jump(6.2); this.sq = -0.35; }
        if (!this.grounded) { const s = 5.2 * T.speed; vx = Math.sin(this.facing) * s; vz = Math.cos(this.facing) * s; }
        if (this.dist < 3.6 && this.grounded && this.cd <= 0) { this.setState('windup'); this.ctx.audio.play('telegraph', 0.6); }
        if (this.playerHomeDist > 30 || !this.ctx.player.alive) { this.aggro = false; this.setState('return'); }
        break;
      }
      case 'windup':
        this.face(dt, 5);
        this.sq = damp(this.sq, 0.75, 10, dt);
        this.flash = Math.max(this.flash, 0.25 + 0.25 * Math.sin(this.stateT * 40));
        if (this.stateT > 0.55) {
          this.lungeX = Math.sin(this.facing); this.lungeZ = Math.cos(this.facing);
          this.hitDone = false; this.jump(5.5); this.sq = -0.6;
          this.setState('lunge');
          this.ctx.audio.play('dodge', 0.6);
        }
        break;
      case 'lunge':
        vx = this.lungeX * 12.5; vz = this.lungeZ * 12.5;
        if (!this.hitDone && this.dist < this.radius + 0.75 && Math.abs(this.ctx.player.pos.y - this.pos.y) < 1.5) { this.hitDone = true; this.hitPlayer(T.dmg, 8); }
        if (this.stateT > 0.42 || (this.stateT > 0.15 && this.grounded)) { this.sq = 0.5; this.cd = 0.9 + Math.random() * 0.7; this.setState('recover'); }
        break;
      case 'recover':
        if (this.stateT > 0.75) this.setState('chase');
        break;
      case 'stagger':
        if (this.stateT > 0.32) this.setState('chase');
        break;
      case 'return': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        const l = Math.hypot(hx, hz);
        this.facing = dampAngle(this.facing, yawOf(hx, hz), 6, dt);
        this.hopT += dt;
        if (this.grounded && this.hopT > 0.4) { this.hopT = 0; this.jump(5.5); }
        if (!this.grounded && l > 0.5) { vx = (hx / l) * 4.5; vz = (hz / l) * 4.5; }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3 * dt);
        if (l < 1.5) this.setState('idle');
        if (canSee && this.playerHomeDist < 22) this.setState('chase');
        break;
      }
    }
    const wasAir = !this.grounded;
    this.move(vx, vz, dt);
    if (wasAir && this.grounded) this.sq = Math.max(this.sq, 0.45);
    // 果冻形变
    this.sq = damp(this.sq, this.state === 'windup' ? this.sq : 0, 9, dt);
    const idle = Math.sin(this.ctx.time * 3 + this.home.x) * 0.04;
    this.bodyM.scale.set(1 + this.sq * 0.4 + idle, 1 - this.sq * 0.5 - idle, 1 + this.sq * 0.4 + idle);
  }
}

// ============================================================ 石像卫士
const GOLEM_TIERS = [
  { hp: 150, dmg: 22, tint: 0xffffff, color: 0xffb060, speed: 2.7 },
  { hp: 230, dmg: 28, tint: 0xffe0b0, color: 0xff8040, speed: 3.0 },
  { hp: 200, dmg: 26, tint: 0xb0d0ff, color: 0x80d0ff, speed: 3.0 },
];
export class Golem extends Enemy {
  private torso: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private core: THREE.Mesh;
  private poise = 0;
  private didHit = false;
  private cd = 0;
  private walk = 0;
  private T;
  constructor(ctx: Ctx, x: number, y: number, z: number, private tier = 0, facing = 0) {
    super(ctx, x, y, z, GOLEM_TIERS[tier].tint);
    this.T = GOLEM_TIERS[tier];
    this.hp = this.maxHp = this.T.hp;
    this.radius = 1.15; this.hitRadius = 1.25; this.hitHeight = 2.8;
    this.knockScale = 0.12;
    this.dropChance = 1;
    this.facing = facing;
    this.torso = this.part('golem_body', () => {
      const b = new MeshBuilder(0.08, 41);
      const S = 0x8a8478, S2 = 0xb4ac9c, M = 0x5a7a4a;
      b.rock(1.05, 3, S, 0, 1.75, 0, 1.15, 0.95, 0.85, 0, S2);
      b.rock(0.7, 5, S, 0, 0.85, 0, 1.1, 0.8, 0.9, 0, S2);
      b.box(0.5, 0.8, 0.55, S, 0.45, 0.4, 0, 0, 0, 0, S2); b.box(0.5, 0.8, 0.55, S, -0.45, 0.4, 0, 0, 0, 0, S2);
      b.rock(0.48, 7, S2, 0, 2.75, 0.1, 1, 0.85, 1);
      b.rock(0.5, 9, M, 0.6, 2.5, -0.3, 1, 0.5, 1); b.rock(0.4, 11, M, -0.7, 2.3, -0.2, 1, 0.5, 1);
      return b.build();
    });
    const armGeo = () => {
      const b = new MeshBuilder(0.08, 43);
      b.rock(0.5, 13, 0x8a8478, 0, -0.1, 0, 1, 1, 1, 0, 0xb4ac9c);
      b.box(0.5, 1.1, 0.5, 0x7a7468, 0, -0.85, 0, 0, 0, 0, 0xa49c8c);
      b.rock(0.62, 15, 0x9a9488, 0, -1.65, 0, 1, 1, 1, 0, 0xc4bcac);
      return b.build();
    };
    this.armL = this.part('golem_arm', armGeo); this.armL.position.set(1.35, 2.25, 0);
    this.armR = this.part('golem_arm', armGeo); this.armR.position.set(-1.35, 2.25, 0);
    this.core = this.part('golem_core', () => {
      const b = new MeshBuilder(0, 1);
      b.add(new THREE.OctahedronGeometry(0.3, 0), 0xffffff, new THREE.Matrix4().makeTranslation(0, 1.8, 0.82));
      b.box(0.14, 0.08, 0.06, 0xffffff, 0.17, 2.8, 0.5); b.box(0.14, 0.08, 0.06, 0xffffff, -0.17, 2.8, 0.5);
      return b.build();
    }, this.group, ctx.mats.glow(this.T.color, 0.15, 0x221a14));
    this.core.castShadow = false;
    this.initBody(0.75, 1.0);
    this.setState('dormant');
    this.pose(0, 0, -0.6);
    this.sync();
  }
  protected color() { return this.T.color; }
  private pose(l: number, r: number, crouch: number) {
    this.armL.rotation.x = l; this.armR.rotation.x = r;
    this.group.children.forEach((m) => { if (m !== this.armL && m !== this.armR) m.position.y = crouch; });
    this.armL.position.y = 2.25 + crouch; this.armR.position.y = 2.25 + crouch;
  }
  private setGlow(k: number) { this.core.material = this.ctx.mats.glow(this.T.color, k, k > 1 ? 0xffffff : 0x221a14); }
  respawn() { super.respawn(); this.poise = 0; this.setState('dormant'); this.setGlow(0.15); this.pose(0, 0, -0.6); }
  canBeHit() { return this.alive; }
  protected modifyDamage(h: HitInfo) {
    // 沉睡 / 行动中外壳坚硬；攻击后的硬直期核心暴露，伤害提高
    if (this.state === 'recover' || this.state === 'stagger') return Math.round(h.damage * 1.5);
    if (this.state === 'dormant') return Math.round(h.damage * 0.5);
    return h.damage;
  }
  protected onDamaged(_h: HitInfo, dmg: number) {
    if (this.state === 'dormant') { this.setState('awaken'); this.ctx.audio.play('roar', 0.5); return; }
    this.poise += dmg;
    if (this.poise > this.maxHp * 0.42 && this.state !== 'stagger') {
      this.poise = 0;
      this.setState('stagger');
      this.ctx.audio.play('break');
      this.ctx.ui.toast('石像卫士失去平衡！', 'good');
    }
  }

  protected think(dt: number) {
    const c = this.ctx, T = this.T;
    let vx = 0, vz = 0;
    let aL = 0, aR = 0, crouch = 0;
    this.cd = Math.max(0, this.cd - dt);
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    switch (this.state) {
      case 'dormant':
        crouch = -0.6;
        if ((this.dist < 9 && Math.abs(c.player.pos.y - this.pos.y) < 4) || this.aggro) { this.aggro = true; this.setState('awaken'); c.audio.play('roar', 0.5); c.cam.shake(0.25); }
        break;
      case 'awaken': {
        const k = clamp01(this.stateT / 1.1);
        crouch = -0.6 * (1 - k);
        aL = aR = -Math.sin(k * Math.PI) * 1.2;
        this.setGlow(0.15 + k * 2.4);
        if (Math.random() < dt * 30) c.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z, spread: 1.3, speed: 2, vy: 2, life: 0.6, size: 0.3, color: 0xc8c0b0, additive: false, gravity: 8 });
        if (this.stateT > 1.1) this.setState('chase');
        break;
      }
      case 'chase': {
        this.face(dt, 3.5);
        this.walk += dt * 5;
        const sw = Math.sin(this.walk);
        aL = sw * 0.5; aR = -sw * 0.5;
        crouch = Math.abs(sw) * 0.08;
        if (this.dist > 3.2) { vx = fx * T.speed; vz = fz * T.speed; }
        if (this.dist < 4.6 && this.cd <= 0 && Math.abs(angleDiff(yawOf(this.dx, this.dz), this.facing)) < 0.7) {
          this.didHit = false;
          if (Math.random() < 0.55 || this.dist > 3.6) {
            this.setState('slam');
            c.fx.telegraph(this.pos.x + fx * 2.2, this.pos.y + 0.08, this.pos.z + fz * 2.2, 3.6, 0.95, 0xff5030);
          } else this.setState('sweep');
          c.audio.play('telegraph');
        }
        if (this.playerHomeDist > 34 || !c.player.alive) { this.aggro = false; this.setState('return'); }
        break;
      }
      case 'slam': {
        const t = this.stateT;
        if (t < 0.95) { const k = clamp01(t / 0.8); aL = aR = -2.9 * k; crouch = 0.25 * k; }
        else { aL = aR = -0.9; crouch = -0.3; }
        if (!this.didHit && t >= 0.95) {
          this.didHit = true;
          const ix = this.pos.x + fx * 2.2, iz = this.pos.z + fz * 2.2;
          c.audio.play('slam'); c.cam.shake(0.6);
          c.fx.ring(ix, this.pos.y + 0.15, iz, 0.5, 5, 0.45, 0xffa050);
          c.particles.emit({ n: 30, x: ix, y: this.pos.y + 0.2, z: iz, spread: 1.5, speed: 6, vy: 5, life: 0.8, size: 0.34, color: 0xd8c8b0, color2: 0x7a6a58, gravity: 16, additive: false });
          const p = c.player.pos;
          if (Math.hypot(p.x - ix, p.z - iz) < 3.7 && Math.abs(p.y - this.pos.y) < 2) this.hitPlayer(T.dmg, 11);
          c.projectiles.spawnWave(ix, this.pos.y, iz, 3.2, 11, 10, Math.round(T.dmg * 0.6));
        }
        if (t > 1.2) { this.setState('recover'); this.setGlow(4.5); }
        break;
      }
      case 'sweep': {
        const t = this.stateT;
        if (t < 0.6) { aR = -1.5 * clamp01(t / 0.5); this.group.rotation.y = this.facing; this.facing -= dt * 0.9; }
        else { aR = -1.5; this.facing += dt * 7 * (t < 0.85 ? 1 : 0); }
        aL = 0.3;
        if (!this.didHit && t >= 0.62 && t < 0.86) {
          const p = c.player.pos;
          if (this.dist < 4.1 && Math.abs(p.y - this.pos.y) < 2 && Math.abs(angleDiff(yawOf(this.dx, this.dz), this.facing)) < 1.5) { this.didHit = true; this.hitPlayer(Math.round(T.dmg * 0.8), 13); }
          if (t - dt < 0.62) { c.audio.play('swingHeavy'); c.fx.slash(this.pos.x, this.pos.y + 1.4, this.pos.z, this.facing, { scale: 4.6, color: 0xffb070, dir: -1, life: 0.3 }); }
        }
        if (t > 1.0) { this.setState('recover'); this.setGlow(4.5); }
        break;
      }
      case 'recover':
        crouch = -0.35; aL = aR = -0.5;
        if (this.stateT > 1.5) { this.cd = 0.5 + Math.random() * 0.8; this.setGlow(2.5); this.setState('chase'); }
        break;
      case 'stagger':
        crouch = -0.5; aL = aR = 0.3;
        this.group.rotation.z = Math.sin(this.stateT * 22) * 0.04;
        if (this.stateT > 2.0) { this.group.rotation.z = 0; this.setState('chase'); }
        break;
      case 'return': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        const l = Math.hypot(hx, hz);
        this.facing = dampAngle(this.facing, yawOf(hx, hz), 4, dt);
        this.walk += dt * 5; aL = Math.sin(this.walk) * 0.5; aR = -aL;
        if (l > 0.6) { vx = (hx / l) * T.speed; vz = (hz / l) * T.speed; }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.2 * dt);
        if (l < 1) { this.setState('dormant'); this.setGlow(0.15); }
        if (this.dist < 10 && this.playerHomeDist < 26 && c.player.alive) { this.aggro = true; this.setState('chase'); }
        break;
      }
    }
    this.move(vx, vz, dt);
    const k = 1 - Math.exp(-14 * dt);
    this.pose(this.armL.rotation.x + (aL - this.armL.rotation.x) * k, this.armR.rotation.x + (aR - this.armR.rotation.x) * k, this.torso.position.y + (crouch - this.torso.position.y) * k);
  }
}

// ============================================================ 幽光灵
const WISP_TIERS = [
  { hp: 34, dmg: 13, color: 0xc070ff, shots: 1 },
  { hp: 34, dmg: 13, color: 0xff7ab0, shots: 1 },
  { hp: 48, dmg: 16, color: 0x70c8ff, shots: 3 },
];
export class Wisp extends Enemy {
  private shell: THREE.Mesh;
  private coreM: THREE.Mesh;
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private cd = 1 + Math.random() * 1.5;
  private blinkCd = 0;
  private hover = 2.3;
  private T;
  constructor(ctx: Ctx, x: number, y: number, z: number, private tier = 1) {
    super(ctx, x, y, z);
    this.T = WISP_TIERS[tier];
    this.hp = this.maxHp = this.T.hp;
    this.flying = true;
    this.solid = false;
    this.radius = 0.6; this.hitRadius = 0.75; this.hitHeight = 1.6;
    this.pos.y = y + this.hover;
    this.coreM = this.part('wisp_core', () => new THREE.IcosahedronGeometry(0.34, 1), this.group, ctx.mats.glow(this.T.color, 2.6, 0xffffff));
    this.coreM.castShadow = false;
    this.shell = this.part('wisp_shell', () => {
      const b = new MeshBuilder(0.05, 51);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        b.add(new THREE.TetrahedronGeometry(0.3), 0x3a2a5a, new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0.72, Math.sin(i * 2.3) * 0.25, 0)), 0x8a70c0);
      }
      b.cone(0.22, 0.7, 4, 0x3a2a5a, 0, -0.75, 0, Math.PI, 0, 0, 0x8a70c0);
      b.cone(0.16, 0.4, 4, 0x4a3a6a, 0, 0.68, 0);
      return b.build();
    });
    this.sync();
  }
  protected color() { return this.T.color; }
  respawn() { super.respawn(); this.pos.y = this.home.y + this.hover; this.cd = 1.5; this.sync(); }
  protected onDamaged(h: HitInfo) { if (h.source === 'sword' && this.blinkCd <= 0) this.blink(); }

  private blink() {
    const c = this.ctx;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU, r = 8 + Math.random() * 4;
      const x = c.player.pos.x + Math.cos(a) * r, z = c.player.pos.z + Math.sin(a) * r;
      const g = c.world.groundAt(x, z, this.home.y);
      if (g === null || Math.hypot(x - this.home.x, z - this.home.z) > 20) continue;
      c.fx.burst(this.pos.x, this.pos.y, this.pos.z, 0.3, 1.6, 0.25, this.T.color, 0.7);
      c.particles.emit({ n: 14, x: this.pos.x, y: this.pos.y, z: this.pos.z, speed: 4, life: 0.4, size: 0.2, color: this.T.color });
      this.pos.set(x, g + this.hover, z);
      c.fx.burst(x, this.pos.y, z, 1.6, 0.3, 0.25, this.T.color, 0.7);
      c.audio.play('dodge', 0.5);
      this.blinkCd = 3.2;
      this.cd = Math.max(this.cd, 0.7);
      if (this.state === 'charge') this.setState('strafe');
      return;
    }
  }

  protected think(dt: number) {
    const c = this.ctx, T = this.T;
    const t = c.time;
    this.blinkCd = Math.max(0, this.blinkCd - dt);
    this.cd = Math.max(0, this.cd - dt);
    this.shell.rotation.y += dt * (this.state === 'charge' ? 9 : 1.6);
    let vx = 0, vz = 0;
    const py = c.player.pos.y;
    const see = this.dist < 19 && Math.abs(py - this.home.y) < 7 && c.player.alive;
    switch (this.state) {
      case 'idle': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        vx = hx * 0.8 + Math.cos(t * 0.7 + this.home.x) * 0.8; vz = hz * 0.8 + Math.sin(t * 0.9 + this.home.z) * 0.8;
        if (see || this.aggro) { this.aggro = true; this.setState('strafe'); }
        break;
      }
      case 'strafe': {
        this.face(dt, 6);
        const nx = this.dx / (this.dist || 1), nz = this.dz / (this.dist || 1);
        const radial = this.dist > 12 ? 1 : this.dist < 8 ? -1 : 0;
        vx = nx * radial * 4 + -nz * this.orbitDir * 3; vz = nz * radial * 4 + nx * this.orbitDir * 3;
        if (Math.random() < dt * 0.25) this.orbitDir *= -1;
        if (this.dist < 4.2 && this.blinkCd <= 0) this.blink();
        if (this.cd <= 0 && this.dist < 17) { this.setState('charge'); c.audio.play('telegraph', 0.7); }
        if (this.playerHomeDist > 32 || !c.player.alive) { this.aggro = false; this.setState('idle'); }
        break;
      }
      case 'charge': {
        this.face(dt, 8);
        const k = clamp01(this.stateT / 0.75);
        this.coreM.scale.setScalar(1 + k * 0.9);
        if (Math.random() < dt * 40) c.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y, z: this.pos.z, spread: 1.4, speed: -0.1, life: 0.3, size: 0.16, color: T.color });
        if (this.stateT > 0.75) {
          const tx = c.player.pos.x - this.pos.x, ty = py + 0.9 - this.pos.y, tz = c.player.pos.z - this.pos.z;
          const l = Math.hypot(tx, ty, tz) || 1;
          for (let i = 0; i < T.shots; i++) {
            const off = (i - (T.shots - 1) / 2) * 0.26;
            const cs = Math.cos(off), sn = Math.sin(off);
            const dx = (tx / l) * cs - (tz / l) * sn, dz = (tx / l) * sn + (tz / l) * cs;
            c.projectiles.spawnOrb(this.pos.x + dx * 0.6, this.pos.y, this.pos.z + dz * 0.6, dx, ty / l, dz, 11.5, T.dmg, T.shots > 1 ? 0 : 1.1, T.color, 4.5);
          }
          c.audio.play('orb');
          this.coreM.scale.setScalar(1);
          this.cd = 1.9 + Math.random() * 1.2;
          this.setState('strafe');
        }
        break;
      }
    }
    // 悬浮移动：不离开岛面太远
    vx += this.knock.x; vz += this.knock.z;
    const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    const g = c.world.groundAt(nx, nz, this.home.y);
    if (g !== null) {
      this.pos.x = nx; this.pos.z = nz;
      this.pos.y = damp(this.pos.y, g + this.hover + Math.sin(t * 2.2 + this.home.x) * 0.22, 4, dt);
    } else this.orbitDir *= -1;
  }
}
