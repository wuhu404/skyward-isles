/**
 * 玩家控制器：Rapier 运动学角色控制器 + 状态机（普通 / 攻击 / 闪避 / 施法 / 受击 / 死亡）。
 */
import * as THREE from 'three';
import { RAPIER, CG_PLAYER, Q_SOLID } from '../core/Physics';
import type { Ctx, Hittable } from '../core/Context';
import { angleDiff, clamp, damp, dampAngle, yawOf } from '../core/math';
import { Humanoid, type AnimMode } from './Humanoid';
import { SwordTrail } from '../gfx/Effects';

const HALF_H = 0.45;
const RADIUS = 0.35;
const CENTER = HALF_H + RADIUS;
const WALK = 6;
const SPRINT = 9.2;
const GRAVITY = 28;
const JUMP_V = 10;
const DJUMP_V = 9.2;
const GLIDE_FALL = -2.4;
const GLIDE_SPEED = 10;

interface AttackDef { dur: number; hit0: number; hit1: number; dmg: number; range: number; arc: number; knock: number; lunge: number; heavy: boolean; chain: number; }
const ATTACKS: AttackDef[] = [
  { dur: 0.38, hit0: 0.09, hit1: 0.22, dmg: 1.0, range: 2.7, arc: 2.3, knock: 5, lunge: 6, heavy: false, chain: 0.2 },
  { dur: 0.38, hit0: 0.09, hit1: 0.22, dmg: 1.15, range: 2.7, arc: 2.3, knock: 5, lunge: 6, heavy: false, chain: 0.2 },
  { dur: 0.66, hit0: 0.2, hit1: 0.4, dmg: 2.1, range: 3.3, arc: 6.4, knock: 12, lunge: 7.5, heavy: true, chain: 0.5 },
];

export type PlayerState = 'normal' | 'attack' | 'dodge' | 'cast' | 'hurt' | 'dead';

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = Math.PI;
  hp = 100;
  stamina = 100;
  potions = 3;
  weaponLevel = 0;
  state: PlayerState = 'normal';
  grounded = false;
  gliding = false;
  model = new Humanoid();
  private trail = new SwordTrail();
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private stateT = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private airJumps = 0;
  private airDodge = true;
  private airTime = 0;
  private jumpHeld = false;
  private jumpCut = false;
  iframe = 0;
  private blink = 0;
  private staminaDelay = 0;
  private atkIdx = 0;
  private atkQueued = false;
  private comboTimer = 0;
  private atkHit = new Set<Hittable>();
  private atkSwung = false;
  private dodgeX = 0;
  private dodgeZ = 0;
  skillCd = 0;
  potionCd = 0;
  private castFired = false;
  private flashT = 0;
  private stepT = 0;
  private safeT = 0;
  lastSafe = new THREE.Vector3();
  private carry = new THREE.Vector3();
  private knock = new THREE.Vector3();
  private desired = { x: 0, y: 0, z: 0 };
  private tmp = new THREE.Vector3();
  private push = new THREE.Vector3();
  /** 供 HUD 显示的受击延迟条 */
  sprinting = false;
  /** 禁用输入（过场 / 祭坛演出） */
  frozen = 0;

  constructor(private ctx: Ctx) {
    const p = ctx.physics;
    const { body, collider } = p.capsule(0, CENTER, 0, HALF_H, RADIUS, CG_PLAYER);
    this.body = body;
    this.collider = collider;
    this.cc = p.controller(0.03, 0.45, 0.35);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(70);
    ctx.scene.add(this.model.root, this.trail.mesh);
  }

  get maxHp() { return this.ctx.save.maxHp; }
  get maxStamina() { return this.ctx.save.maxStamina; }
  get alive() { return this.state !== 'dead'; }
  get damage() { return 14 + this.weaponLevel * 5; }
  get center() { return this.tmp.set(this.pos.x, this.pos.y + CENTER, this.pos.z); }
  get invulnerable() { return this.iframe > 0 || this.state === 'dead'; }

  teleport(x: number, y: number, z: number, facing?: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.carry.set(0, 0, 0);
    this.body.setTranslation({ x, y: y + CENTER, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
    if (facing !== undefined) this.facing = facing;
    this.lastSafe.copy(this.pos);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.facing;
    this.trail.reset();
  }

  /** 复活 / 读档后重置 */
  revive(full = true) {
    this.state = 'normal';
    this.stateT = 0;
    if (full) { this.hp = this.maxHp; this.potions = this.ctx.save.potionsMax; }
    this.stamina = this.maxStamina;
    this.iframe = 1.2;
    this.gliding = false;
    this.atkQueued = false;
    this.frozen = 0;
    this.model.root.visible = true;
  }

  heal(amount: number) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp > before) this.ctx.ui.damageNumber(this.center, Math.round(this.hp - before), 'heal');
  }

  private setState(s: PlayerState) { this.state = s; this.stateT = 0; }

  takeDamage(amount: number, fromX: number, fromZ: number, knock = 7): boolean {
    if (this.invulnerable) return false;
    const c = this.ctx;
    this.hp -= amount;
    this.iframe = 0.95;
    this.flashT = 1;
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    this.knock.set(dx * knock, 0, dz * knock);
    if (knock > 9) this.vel.y = Math.max(this.vel.y, 5);
    c.cam.shake(0.45 + Math.min(0.4, amount / 60));
    c.audio.play('hurt');
    c.hitStop(0.07);
    c.ui.damageNumber(this.center, Math.round(amount), 'player');
    c.particles.emit({ n: 14, x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, speed: 5, life: 0.4, size: 0.22, color: 0xff5544, color2: 0xffcc88, gravity: 6 });
    this.gliding = false;
    this.atkQueued = false;
    this.trail.active = false;
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    this.setState('hurt');
    return true;
  }

  die() {
    if (this.state === 'dead') return;
    this.setState('dead');
    this.hp = 0;
    this.vel.x = this.vel.z = 0;
    this.ctx.audio.play('death');
    this.ctx.onPlayerDeath();
  }

  update(dt: number) {
    const c = this.ctx;
    const inp = c.input;
    const save = c.save;
    this.stateT += dt;
    this.iframe = Math.max(0, this.iframe - dt);
    this.skillCd = Math.max(0, this.skillCd - dt);
    this.potionCd = Math.max(0, this.potionCd - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    const ctl = this.state !== 'dead' && this.frozen <= 0;

    // ---------- 输入 → 期望方向（相机相对） ----------
    let ix = 0, iz = 0;
    if (ctl) {
      const fx = c.cam.forwardX, fz = c.cam.forwardZ;
      const mx = inp.moveX, my = inp.moveY;
      ix = fx * my + -fz * mx;
      iz = fz * my + fx * mx;
      const l = Math.hypot(ix, iz);
      if (l > 0) { ix /= l; iz /= l; }
    }
    const hasInput = ix !== 0 || iz !== 0;

    if (ctl && inp.wasPressed('jump')) { this.jumpBuf = 0.13; }
    this.jumpHeld = ctl && inp.isDown('jump');
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // ---------- 状态切换 ----------
    if (ctl) {
      if (inp.wasPressed('potion')) this.usePotion();
      const free = this.state === 'normal';
      const atkChain = this.state === 'attack' && this.stateT >= ATTACKS[this.atkIdx].chain;
      if (inp.wasPressed('dodge') && (free || this.state === 'attack' || (this.state === 'cast' && this.castFired)) && this.stamina >= 12 && (this.grounded || this.airDodge)) {
        this.startDodge(ix, iz, hasInput);
      } else if (inp.wasPressed('attack')) {
        if (free) this.startAttack(this.comboTimer > 0 ? (this.atkIdx + 1) % 3 : 0, ix, iz, hasInput);
        else if (this.state === 'attack') this.atkQueued = true;
      } else if (inp.wasPressed('skill') && save.abilities.windBlade && (free || atkChain) && this.skillCd <= 0) {
        if (this.stamina >= 20) this.startCast();
        else c.ui.toast('体力不足');
      }
      if (this.state === 'attack' && this.atkQueued && atkChain && this.atkIdx < 2) {
        this.startAttack(this.atkIdx + 1, ix, iz, hasInput);
      }
    }

    // ---------- 各状态的水平运动 ----------
    let targetVX = 0, targetVZ = 0, accel = this.grounded ? 70 : 24;
    this.sprinting = false;
    const updraft = c.world.updraftAt(this.pos);
    switch (this.state) {
      case 'normal': {
        let speed = WALK;
        if (inp.isDown('sprint') && hasInput && this.stamina > 0 && ctl) {
          speed = SPRINT;
          this.sprinting = true;
          if (this.grounded) { this.stamina -= 11 * dt; this.staminaDelay = 0.7; }
        }
        if (this.gliding) { speed = GLIDE_SPEED; accel = 14; }
        targetVX = ix * speed; targetVZ = iz * speed;
        if (hasInput) this.facing = dampAngle(this.facing, yawOf(ix, iz), this.gliding ? 5 : 16, dt);
        // 跳跃 / 二段跳
        if (this.jumpBuf > 0) {
          if (this.grounded || this.coyote > 0) {
            this.jump(JUMP_V);
            c.audio.play('jump');
            this.dust(8);
          } else if (save.abilities.doubleJump && this.airJumps > 0) {
            this.airJumps--;
            this.jump(DJUMP_V);
            this.gliding = false;
            c.audio.play('doubleJump');
            c.fx.ring(this.pos.x, this.pos.y + 0.1, this.pos.z, 0.3, 1.6, 0.35, 0xaef6ff, 0.8);
            c.particles.emit({ n: 14, x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z, speed: 3.5, flat: true, life: 0.45, size: 0.2, color: 0xbff8ff, color2: 0x4fd0ff });
          }
        }
        // 滑翔：空中下落时按住跳跃
        const wantGlide = save.abilities.glide && !this.grounded && this.jumpHeld && this.jumpBuf <= 0 && (this.vel.y < 0.5 || updraft > 0) && this.airTime > 0.18;
        if (wantGlide && !this.gliding) c.audio.play('glide');
        this.gliding = wantGlide;
        break;
      }
      case 'attack': {
        const a = ATTACKS[this.atkIdx];
        const t = this.stateT;
        const lunge = t < 0.16 ? a.lunge * (1 - t / 0.16) : 0;
        targetVX = Math.sin(this.facing) * lunge;
        targetVZ = Math.cos(this.facing) * lunge;
        accel = 120;
        this.trail.active = t >= a.hit0 - 0.05 && t <= a.hit1 + 0.06;
        if (!this.atkSwung && t >= a.hit0 - 0.03) {
          this.atkSwung = true;
          this.spawnSlash();
        }
        if (t >= a.hit0 && t <= a.hit1) this.attackHits(a);
        if (t >= a.dur) { this.trail.active = false; this.comboTimer = 0.45; this.setState('normal'); }
        break;
      }
      case 'dodge': {
        const u = this.stateT / 0.44;
        const sp = 14.5 * (1 - u * 0.62);
        targetVX = this.dodgeX * sp; targetVZ = this.dodgeZ * sp;
        accel = 200;
        if (this.stateT > 0.44) this.setState('normal');
        break;
      }
      case 'cast': {
        accel = 40;
        if (!this.castFired && this.stateT >= 0.14) { this.castFired = true; this.fireBlade(); }
        if (this.stateT >= 0.42) this.setState('normal');
        break;
      }
      case 'hurt':
        accel = 30;
        if (this.stateT > 0.28) this.setState('normal');
        break;
      case 'dead':
        accel = 30;
        break;
    }
    if (this.state !== 'normal') this.gliding = false;

    const k = Math.min(1, (accel * dt) / Math.max(0.001, Math.hypot(targetVX - this.vel.x, targetVZ - this.vel.z)));
    this.vel.x += (targetVX - this.vel.x) * k;
    this.vel.z += (targetVZ - this.vel.z) * k;

    // ---------- 竖直运动 ----------
    if (updraft > 0) {
      // 上升气流：抵消重力并把竖直速度拉向气流速度
      this.vel.y = damp(this.vel.y, updraft, 4, dt);
      this.airJumps = save.abilities.doubleJump ? 1 : 0;
      this.grounded = false;
    } else if (this.grounded && this.vel.y <= 0) this.vel.y = -3;
    else {
      const g = this.state === 'attack' || this.state === 'dodge' ? GRAVITY * 0.45 : GRAVITY;
      this.vel.y -= g * dt;
      if (!this.jumpCut && !this.jumpHeld && this.vel.y > 4.5) { this.vel.y *= 0.55; this.jumpCut = true; }
      if (this.gliding) this.vel.y = damp(this.vel.y, GLIDE_FALL, 9, dt);
      this.vel.y = Math.max(this.vel.y, -42);
    }

    // 击退衰减
    this.knock.x = damp(this.knock.x, 0, 7, dt);
    this.knock.z = damp(this.knock.z, 0, 7, dt);
    // 敌人软推挤，避免重叠
    c.world.pushOut(this.pos, RADIUS, this.push);

    // ---------- 角色控制器移动 ----------
    const d = this.desired;
    d.x = (this.vel.x + this.knock.x + this.push.x) * dt + this.carry.x;
    d.y = this.vel.y * dt + this.carry.y;
    d.z = (this.vel.z + this.knock.z + this.push.z) * dt + this.carry.z;
    this.cc.computeColliderMovement(this.collider, d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, CG_PLAYER);
    const m = this.cc.computedMovement();
    const wasGrounded = this.grounded;
    const fallV = this.vel.y;
    this.grounded = this.cc.computedGrounded() && this.vel.y <= 0.5;
    if (this.vel.y > 0 && m.y < d.y * 0.4) this.vel.y = 0; // 撞到头顶
    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER, z: this.pos.z });

    // 落地 / 离地
    if (this.grounded) {
      if (!wasGrounded) {
        if (fallV < -9) {
          this.model.squash = Math.min(1, -fallV / 30);
          c.audio.play('land', Math.min(1, -fallV / 22));
          this.dust(10);
        }
        this.jumpCut = false;
      }
      this.coyote = 0.12;
      this.airTime = 0;
      this.airJumps = save.abilities.doubleJump ? 1 : 0;
      this.airDodge = true;
      this.gliding = false;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
      this.airTime += dt;
    }

    // 移动平台携带 + 安全落点记录
    this.carry.set(0, 0, 0);
    if (this.grounded) {
      const hit = c.physics.raycast(this.pos.x, this.pos.y + 0.5, this.pos.z, 0, -1, 0, 1.0, Q_SOLID, this.collider);
      let onPlatform = false;
      if (hit) {
        const pd = c.world.platformDelta(hit.collider.handle);
        if (pd) { this.carry.copy(pd); onPlatform = true; }
        else if (hit.collider.parent()?.isDynamic()) onPlatform = true;
      }
      this.safeT -= dt;
      if (!onPlatform && this.safeT <= 0 && this.state !== 'dead') {
        this.safeT = 0.25;
        const p = c.physics;
        const y = this.pos.y + 0.6;
        const r = 1.1;
        if (p.groundY(this.pos.x + r, y, this.pos.z, 2) !== null && p.groundY(this.pos.x - r, y, this.pos.z, 2) !== null &&
          p.groundY(this.pos.x, y, this.pos.z + r, 2) !== null && p.groundY(this.pos.x, y, this.pos.z - r, 2) !== null) {
          this.lastSafe.copy(this.pos);
        }
      }
    }

    // 坠落出界
    if (this.pos.y < this.lastSafe.y - 55 && this.state !== 'dead') this.fallOut();

    // ---------- 体力 ----------
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + 30 * dt);
    this.stamina = Math.max(0, this.stamina);

    // ---------- 动画 / 表现 ----------
    const hv = Math.hypot(this.vel.x, this.vel.z);
    let mode: AnimMode = 'idle';
    let t = 0;
    switch (this.state) {
      case 'dead': mode = 'dead'; t = this.stateT / 0.9; break;
      case 'dodge': mode = 'dodge'; t = this.stateT / 0.44; break;
      case 'attack': mode = (['attack1', 'attack2', 'attack3'] as const)[this.atkIdx]; t = this.stateT / ATTACKS[this.atkIdx].dur; break;
      case 'cast': mode = 'cast'; t = this.stateT / 0.42; break;
      case 'hurt': mode = 'hurt'; break;
      default:
        if (!this.grounded && this.airTime > 0.08) mode = this.gliding ? 'glide' : this.vel.y > 1.5 ? 'jump' : 'fall';
        else if (hv > 0.6) mode = 'run';
    }
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.facing;
    this.model.update(dt, { mode, t, speed: hv / WALK });
    this.trail.update(this.model.basePos, this.model.tipPos);

    this.flashT = Math.max(0, this.flashT - dt * 5);
    this.model.mat.emissiveIntensity = this.flashT * 0.9;
    this.blink += dt;
    this.model.root.visible = !(this.iframe > 0 && this.state !== 'dodge' && this.state !== 'dead' && this.frozen <= 0 && Math.floor(this.blink * 22) % 2 === 0 && this.flashT <= 0);

    // 冲刺尘土 / 滑翔尾迹
    if (this.grounded && this.sprinting && hv > 7) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.09; this.dust(1, 0.9); }
    }
    if (this.gliding) {
      c.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y + 1.7, z: this.pos.z, spread: 1.3, life: 0.5, size: 0.14, color: 0x9ff5ff, alpha: 0.7 });
    }
  }

  private jump(v: number) {
    this.vel.y = v;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.jumpCut = false;
    this.airTime = 0.01;
    this.model.squash = -0.35;
  }

  private dust(n: number, alpha = 0.8) {
    this.ctx.particles.emit({
      n, x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z, spread: 0.25, speed: 2.2, flat: true, vy: 0.8,
      life: 0.5, size: 0.3, sizeEnd: 0.5, color: 0xf2efe0, color2: 0xcfc8b0, alpha: alpha * 0.55, drag: 2.5, additive: false,
    });
  }

  private startDodge(ix: number, iz: number, hasInput: boolean) {
    const c = this.ctx;
    this.stamina -= 22;
    this.staminaDelay = 0.8;
    if (hasInput) { this.dodgeX = ix; this.dodgeZ = iz; this.facing = yawOf(ix, iz); }
    else { this.dodgeX = Math.sin(this.facing); this.dodgeZ = Math.cos(this.facing); }
    if (!this.grounded) { this.airDodge = false; this.vel.y = Math.max(this.vel.y, 2.5); }
    this.iframe = Math.max(this.iframe, 0.36);
    this.trail.active = false;
    this.atkQueued = false;
    this.setState('dodge');
    c.audio.play('dodge');
    this.dust(6);
    c.fx.ring(this.pos.x, this.pos.y + 0.6, this.pos.z, 0.3, 1.3, 0.25, 0xcfefff, 0.5);
  }

  private startAttack(idx: number, ix: number, iz: number, hasInput: boolean) {
    const c = this.ctx;
    this.atkIdx = idx;
    this.atkQueued = false;
    this.atkSwung = false;
    this.atkHit.clear();
    // 自动瞄准：优先输入方向附近的最近目标
    const want = hasInput ? yawOf(ix, iz) : this.facing;
    let best: Hittable | null = null;
    let bestScore = 1e9;
    for (const h of c.world.hittables) {
      if (!h.aimable || !h.canBeHit()) continue;
      const dx = h.hitPos.x - this.pos.x, dz = h.hitPos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) - h.hitRadius;
      if (dist > 5.5 || Math.abs(h.hitPos.y - (this.pos.y + 1)) > 3) continue;
      const ad = Math.abs(angleDiff(yawOf(dx, dz), want));
      if (ad > (hasInput ? 1.2 : 2.6)) continue;
      const score = dist + ad * 2.2;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (best) this.facing = yawOf(best.hitPos.x - this.pos.x, best.hitPos.z - this.pos.z);
    else if (hasInput) this.facing = want;
    this.setState('attack');
    c.audio.play(idx === 2 ? 'swingHeavy' : 'swing');
  }

  private spawnSlash() {
    const c = this.ctx;
    const y = this.pos.y + 1.05;
    const color = [0xbff6ff, 0xd8ffd0, 0xffe9a8, 0xffc0f0][Math.min(3, this.weaponLevel)];
    const fx = Math.sin(this.facing) * 0.3, fz = Math.cos(this.facing) * 0.3;
    if (this.atkIdx === 0) c.fx.slash(this.pos.x + fx, y, this.pos.z + fz, this.facing, { roll: -0.22, dir: 1, scale: 2.7, color });
    else if (this.atkIdx === 1) c.fx.slash(this.pos.x + fx, y, this.pos.z + fz, this.facing, { roll: 0.28, dir: -1, scale: 2.7, color });
    else {
      c.fx.slash(this.pos.x, y - 0.2, this.pos.z, this.facing, { dir: 1, scale: 3.4, color, life: 0.34 });
      c.fx.slash(this.pos.x, y - 0.2, this.pos.z, this.facing + Math.PI, { dir: 1, scale: 3.4, color, life: 0.34 });
    }
  }

  private attackHits(a: AttackDef) {
    const c = this.ctx;
    let hitAny = false;
    for (const h of c.world.hittables) {
      if (this.atkHit.has(h) || !h.canBeHit()) continue;
      const dx = h.hitPos.x - this.pos.x, dz = h.hitPos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > a.range + h.hitRadius) continue;
      if (Math.abs(h.hitPos.y - (this.pos.y + 1)) > h.hitHeight * 0.5 + 1.5) continue;
      if (dist > 0.9 + h.hitRadius && Math.abs(angleDiff(yawOf(dx, dz), this.facing)) > a.arc / 2) continue;
      this.atkHit.add(h);
      const l = dist || 1;
      const crit = a.heavy;
      if (h.onHit({ damage: Math.round(this.damage * a.dmg), dirX: dx / l, dirZ: dz / l, knock: a.knock, heavy: crit, source: 'sword' })) {
        hitAny = true;
        const px = this.pos.x + (dx / l) * Math.max(0.6, dist - h.hitRadius * 0.6);
        const pz = this.pos.z + (dz / l) * Math.max(0.6, dist - h.hitRadius * 0.6);
        c.particles.emit({ n: crit ? 22 : 12, x: px, y: this.pos.y + 1.1, z: pz, speed: crit ? 9 : 6.5, life: 0.32, size: 0.2, color: 0xffffff, color2: 0x7fe8ff, gravity: 9, drag: 2 });
        c.fx.burst(px, this.pos.y + 1.1, pz, 0.2, crit ? 1.5 : 0.9, 0.16, 0xdffaff, 0.8);
      }
    }
    if (hitAny) {
      c.hitStop(a.heavy ? 0.1 : 0.055);
      c.cam.shake(a.heavy ? 0.42 : 0.2);
      c.audio.play(a.heavy ? 'hitHeavy' : 'hit');
    }
  }

  private startCast() {
    this.stamina -= 28;
    this.staminaDelay = 0.8;
    this.skillCd = 0.85;
    this.castFired = false;
    this.facing = yawOf(this.ctx.cam.forwardX, this.ctx.cam.forwardZ);
    this.setState('cast');
  }

  private fireBlade() {
    const c = this.ctx;
    const ox = this.pos.x, oy = this.pos.y + 1.15, oz = this.pos.z;
    // 以相机视线为基准做辅助瞄准
    const cf = c.cam.camera.getWorldDirection(this.tmp);
    let dx = cf.x, dy = clamp(cf.y + 0.12, -0.25, 0.9), dz = cf.z;
    let best: Hittable | null = null;
    let bestAng = 0.42;
    const camPos = c.cam.camera.position;
    for (const h of c.world.hittables) {
      if (!h.aimable || !h.canBeHit()) continue;
      const tx = h.hitPos.x - camPos.x, ty = h.hitPos.y - camPos.y, tz = h.hitPos.z - camPos.z;
      const tl = Math.hypot(tx, ty, tz);
      const pd = Math.hypot(h.hitPos.x - ox, h.hitPos.y - oy, h.hitPos.z - oz);
      if (pd > 46 || tl < 0.01) continue;
      const ang = Math.acos(clamp((tx * cf.x + ty * cf.y + tz * cf.z) / tl, -1, 1));
      if (ang < bestAng) { bestAng = ang; best = h; }
    }
    if (best) { dx = best.hitPos.x - ox; dy = best.hitPos.y - oy; dz = best.hitPos.z - oz; }
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    this.facing = yawOf(dx, dz);
    c.projectiles.spawnBlade(ox + dx * 0.8, oy, oz + dz * 0.8, dx, dy, dz, Math.round(this.damage * 1.5));
    c.audio.play('blade');
    c.cam.shake(0.15);
  }

  private usePotion() {
    const c = this.ctx;
    if (this.potionCd > 0 || this.state === 'dead') return;
    if (this.potions <= 0) { c.ui.toast('没有治疗药水了'); return; }
    if (this.hp >= this.maxHp) { c.ui.toast('生命值已满'); return; }
    this.potions--;
    this.potionCd = 0.6;
    this.heal(Math.round(this.maxHp * 0.45));
    c.audio.play('heal');
    c.particles.emit({ n: 26, x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z, spread: 0.6, vy: 2.5, speed: 1, life: 0.9, size: 0.22, color: 0x9dffb0, color2: 0x30d070 });
    c.fx.pillar(this.pos.x, this.pos.y, this.pos.z, 0.9, 3.5, 0.6, 0x7dffa0);
  }

  private fallOut() {
    const c = this.ctx;
    this.hp -= Math.round(this.maxHp * 0.15);
    c.audio.play('hurt');
    if (this.hp <= 0) { this.hp = 0; this.die(); return; }
    c.flash(1);
    this.teleport(this.lastSafe.x, this.lastSafe.y + 0.3, this.lastSafe.z);
    this.iframe = 1.6;
    this.setState('normal');
    c.cam.snapTo(this.pos);
    c.ui.toast('你从云端坠落，失去了一些生命');
  }

  dispose() {
    this.ctx.scene.remove(this.model.root, this.trail.mesh);
    this.model.dispose();
    this.trail.dispose();
    this.ctx.physics.world.removeCharacterController(this.cc);
    this.ctx.physics.world.removeRigidBody(this.body);
  }
}
