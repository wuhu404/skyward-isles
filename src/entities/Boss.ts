/**
 * Boss「苍穹守卫·岚」：三阶段。
 *  一阶段：追击 + 砸地冲击波 / 横扫
 *  二阶段：+ 扇形光球齐射、蓄力冲撞
 *  三阶段：+ 追踪落雷、三连砸，整体节奏加快
 * 每次攻击后有硬直窗口，核心暴露时伤害提高。
 */
import * as THREE from 'three';
import type { Ctx, HitInfo } from '../core/Context';
import type { BossLike } from '../world/World';
import { MeshBuilder } from '../gfx/geo';
import { angleDiff, clamp01, damp, dampAngle, TAU, yawOf } from '../core/math';
import { Enemy } from './Enemy';

export const BOSS_NAME = '苍穹守卫 · 岚';
const MAX_HP = 1500;

export class Boss extends Enemy implements BossLike {
  started = false;
  defeated = false;
  phase = 1;
  private fistL: THREE.Mesh;
  private fistR: THREE.Mesh;
  private halo: THREE.Mesh;
  private coreM: THREE.Mesh;
  private tL = new THREE.Vector3();
  private tR = new THREE.Vector3();
  private cd = 1.5;
  private step = 0;
  private count = 0;
  private didHit = false;
  private chargeX = 0;
  private chargeZ = 0;
  private bob = 0;
  private last = '';
  private glowK = 2;
  private dyingT = 0;

  constructor(ctx: Ctx, x: number, y: number, z: number, private arenaR: number) {
    super(ctx, x, y, z);
    this.hp = this.maxHp = MAX_HP;
    this.flying = true;
    this.radius = 1.9; this.hitRadius = 2.1; this.hitHeight = 5;
    this.knockScale = 0;
    this.dropChance = 0;
    this.facing = 0;
    this.part('boss_body', () => {
      const b = new MeshBuilder(0.07, 61);
      const A = 0x4a4f78, A2 = 0x8a90c0, G = 0xd8b860;
      b.rock(1.6, 3, A, 0, 3.3, 0, 1.25, 1.0, 0.9, 0, A2);
      b.cone(1.3, 2.6, 6, A, 0, 1.4, 0, Math.PI, 0, 0, A2);
      b.rock(0.95, 5, A2, 2.0, 4.1, 0, 1.1, 0.7, 1); b.rock(0.95, 7, A2, -2.0, 4.1, 0, 1.1, 0.7, 1);
      b.cone(0.4, 1.3, 4, G, 2.3, 5.0, 0, 0, 0, -0.5); b.cone(0.4, 1.3, 4, G, -2.3, 5.0, 0, 0, 0, 0.5);
      b.rock(0.7, 9, 0x6a70a0, 0, 5.1, 0.15, 1, 1.05, 1, 0, 0xb0b8e0);
      b.cone(0.3, 1.2, 4, G, 0.45, 6.0, 0, 0, 0, -0.3); b.cone(0.3, 1.2, 4, G, -0.45, 6.0, 0, 0, 0, 0.3);
      b.box(2.6, 0.3, 0.3, G, 0, 2.6, 1.05); b.box(0.3, 1.6, 0.3, G, 0, 3.2, 1.2);
      return b.build();
    });
    const fist = () => {
      const b = new MeshBuilder(0.07, 63);
      b.rock(1.0, 11, 0x5a608c, 0, 0, 0, 1.1, 1, 1.1, 0, 0xa0a8d8);
      b.box(1.5, 0.4, 1.5, 0xd8b860, 0, 0.75, 0);
      for (let i = 0; i < 3; i++) b.box(0.4, 0.5, 0.5, 0x8a90c0, -0.5 + i * 0.5, -0.7, 0.5);
      return b.build();
    };
    this.fistL = this.part('boss_fist', fist);
    this.fistR = this.part('boss_fist', fist);
    this.coreM = this.part('boss_core', () => {
      const b = new MeshBuilder(0, 1);
      b.add(new THREE.OctahedronGeometry(0.55, 0), 0xffffff, new THREE.Matrix4().makeTranslation(0, 3.3, 1.25));
      b.box(0.3, 0.12, 0.1, 0xffffff, 0.3, 5.2, 0.8); b.box(0.3, 0.12, 0.1, 0xffffff, -0.3, 5.2, 0.8);
      return b.build();
    }, this.group, ctx.mats.glow(0xc9a8ff, 2, 0xffffff));
    this.coreM.castShadow = false;
    this.halo = this.part('boss_halo', () => new THREE.TorusGeometry(1.5, 0.08, 4, 24), this.group, ctx.mats.glow(0xffe9a0, 2.4, 0xffffff));
    this.halo.castShadow = false;
    this.halo.position.set(0, 6.6, -0.4);
    this.rest();
    this.fistL.position.copy(this.tL); this.fistR.position.copy(this.tR);
    this.defeated = ctx.save.bossDefeated;
    if (this.defeated) { this.alive = false; this.group.visible = false; }
    this.setState('dormant');
    this.sync();
  }
  protected color() { return 0xc9a8ff; }
  private rest() { this.tL.set(2.7, 2.4, 0.5); this.tR.set(-2.7, 2.4, 0.5); }
  private setCore(k: number) { if (k !== this.glowK) { this.glowK = k; this.coreM.material = this.ctx.mats.glow(k > 3 ? 0xffe0a0 : 0xc9a8ff, k, 0xffffff); } }

  canBeHit() { return this.alive && this.started && this.state !== 'intro' && this.state !== 'shift' && this.state !== 'dying'; }
  protected modifyDamage(h: HitInfo) { return this.state === 'recover' ? Math.round(h.damage * 1.5) : h.damage; }
  protected onDamaged() {
    const c = this.ctx;
    const f = this.hp / this.maxHp;
    c.ui.setBoss(BOSS_NAME, f, this.phase);
    const want = f <= 0.34 ? 3 : f <= 0.67 ? 2 : 1;
    if (want > this.phase) {
      this.phase = want;
      this.setState('shift');
      c.audio.play('roar');
      c.cam.shake(0.8);
      c.flash(0.5);
      c.projectiles.spawnWave(this.pos.x, this.home.y, this.pos.z, 2, 24, 13, 14);
      c.ui.banner(this.phase === 2 ? '风暴渐起' : '苍穹之怒', this.phase === 2 ? '守卫开始操纵光球与冲撞' : '雷霆降临——留意脚下的预警');
    }
  }
  die() {
    if (!this.alive || this.state === 'dying') return;
    // 不立即消失：进入死亡演出
    this.hp = 0;
    this.setState('dying');
    this.dyingT = 0;
    this.ctx.ui.setBoss(null);
    this.ctx.projectiles.clear();
    this.ctx.audio.play('roar');
    this.ctx.hitStop(0.25);
  }
  respawn() {
    if (this.defeated) return;
    super.respawn();
    this.started = false;
    this.phase = 1;
    this.cd = 1.5;
    this.rest();
    this.setCore(2);
    this.setState('dormant');
    this.ctx.ui.setBoss(null);
  }

  private pick(): string {
    const far = this.dist > 9;
    const opts: string[] = far ? ['slam'] : ['slam', 'sweep'];
    if (this.phase >= 2) { opts.push('volley', 'charge'); if (far) opts.push('volley'); }
    if (this.phase >= 3) opts.push('storm', 'combo');
    let a = opts[Math.floor(Math.random() * opts.length)];
    if (a === this.last) a = opts[Math.floor(Math.random() * opts.length)];
    this.last = a;
    return a;
  }
  private slamAt(local: THREE.Vector3, dmg: number, wave: boolean) {
    const c = this.ctx;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const ix = this.pos.x + fx * local.z + fz * local.x, iz = this.pos.z + fz * local.z - fx * local.x, gy = this.home.y;
    c.audio.play('slam'); c.cam.shake(0.75);
    c.fx.ring(ix, gy + 0.15, iz, 0.5, 6.5, 0.5, 0xffb060);
    c.particles.emit({ n: 40, x: ix, y: gy + 0.2, z: iz, spread: 2, speed: 8, vy: 6, life: 0.9, size: 0.36, color: 0x9a90c0, color2: 0x3a3450, gravity: 16, additive: false });
    const p = c.player.pos;
    if (Math.hypot(p.x - ix, p.z - iz) < 4.4 && p.y - gy < 2.5) this.hitPlayer(dmg, 12);
    if (wave) c.projectiles.spawnWave(ix, gy, iz, 3.5, 20, 11 + this.phase, Math.round(dmg * 0.55));
  }

  protected think(dt: number) {
    const c = this.ctx;
    const pl = c.player;
    const P = this.phase;
    const fast = 1 + (P - 1) * 0.18;
    this.bob += dt;
    this.halo.rotation.z += dt * 0.8;
    this.halo.rotation.x = Math.PI / 2 + Math.sin(this.bob) * 0.15;
    let vx = 0, vz = 0;
    let hover = 0.6 + Math.sin(this.bob * 1.6) * 0.2;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    this.cd = Math.max(0, this.cd - dt);
    const t = this.stateT;

    switch (this.state) {
      case 'dormant':
        hover = -0.8;
        this.tL.set(2.2, 0.9, 0.8); this.tR.set(-2.2, 0.9, 0.8);
        if (this.dist < 17 && Math.abs(pl.pos.y - this.home.y) < 6 && pl.alive) {
          this.started = true;
          this.setState('intro');
          c.audio.play('roar'); c.cam.shake(0.7);
          c.ui.banner(BOSS_NAME, '群岛尽头的最后试炼');
          c.ui.setBoss(BOSS_NAME, 1, 1);
        }
        break;
      case 'intro':
        this.face(dt, 3);
        this.tL.set(3.4, 5.5, 0); this.tR.set(-3.4, 5.5, 0);
        if (Math.random() < dt * 40) c.particles.emit({ n: 1, x: this.pos.x, y: this.pos.y + 3, z: this.pos.z, spread: 4, speed: 3, life: 0.7, size: 0.26, color: 0xc9a8ff });
        if (t > 2.0) { this.rest(); this.setState('chase'); }
        break;
      case 'shift':
        this.tL.set(3.4, 5.5, 0); this.tR.set(-3.4, 5.5, 0);
        this.flash = Math.max(this.flash, 0.4 + 0.3 * Math.sin(t * 30));
        if (t > 1.6) { this.rest(); this.cd = 0.6; this.setState('chase'); }
        break;
      case 'chase': {
        this.face(dt, 4);
        this.rest();
        const sp = (3.4 + P * 0.7);
        if (this.dist > 5.5) { vx = fx * sp; vz = fz * sp; }
        else if (this.dist < 3.5) { vx = -fx * 2; vz = -fz * 2; }
        if (!pl.alive) break;
        if (this.cd <= 0) {
          const a = this.pick();
          this.didHit = false; this.step = 0; this.count = 0;
          this.setState(a);
          if (a === 'slam' || a === 'combo') {
            c.audio.play('telegraph');
          } else if (a === 'charge') {
            c.audio.play('telegraph');
          } else if (a === 'storm') { c.audio.play('roar', 0.6); }
        }
        break;
      }
      case 'slam':
      case 'combo': {
        // 追到玩家附近 → 举拳（预警圈）→ 砸下
        const n = this.state === 'combo' ? 3 : 1;
        const wind = 0.85 / fast;
        if (this.step === 0) {
          this.face(dt, 5);
          if (this.dist > 5) { vx = fx * 9; vz = fz * 9; }
          this.tL.set(1.2, 6.2, 1.5); this.tR.set(-1.2, 6.2, 1.5);
          if (this.dist <= 5.5 || t > 1.4) { this.step = 1; this.stateT = 0; c.fx.telegraph(this.pos.x + fx * 4, this.home.y + 0.08, this.pos.z + fz * 4, 4.4, wind, 0xff5030); }
        } else if (this.step === 1) {
          this.tL.set(1.2, 6.8, 1.0); this.tR.set(-1.2, 6.8, 1.0);
          if (t >= wind) {
            this.tL.set(1.1, -0.6, 4); this.tR.set(-1.1, -0.6, 4);
            this.fistL.position.copy(this.tL); this.fistR.position.copy(this.tR);
            this.slamAt(new THREE.Vector3(0, 0, 4), 26 + P * 2, true);
            this.count++;
            this.step = 2; this.stateT = 0;
          }
        } else {
          if (t > (this.count < n ? 0.45 : 0.3)) {
            if (this.count < n) { this.step = 0; this.stateT = 0; }
            else this.setState('recover');
          }
        }
        break;
      }
      case 'sweep': {
        const wind = 0.6 / fast;
        if (t < wind) { this.tR.set(-4.2, 2.0, -1.0); this.facing -= dt * 0.8; }
        else if (t < wind + 0.3) {
          const k = (t - wind) / 0.3;
          const a = -1.9 + k * 3.8;
          this.tR.set(-Math.cos(a) * 0 + Math.sin(-a) * 4.6, 1.6, Math.cos(a) * 4.6);
          this.fistR.position.copy(this.tR);
          if (t - dt < wind) { c.audio.play('swingHeavy'); c.fx.slash(this.pos.x, this.home.y + 1.6, this.pos.z, this.facing, { scale: 6.4, color: 0xd0b0ff, dir: -1, life: 0.32 }); }
          if (!this.didHit && this.dist < 6.3 && pl.pos.y - this.home.y < 2.6 && Math.abs(angleDiff(yawOf(this.dx, this.dz), this.facing)) < 1.7) { this.didHit = true; this.hitPlayer(22 + P * 2, 14); }
        } else if (t > wind + 0.6) this.setState('recover');
        break;
      }
      case 'volley': {
        this.face(dt, 5);
        hover = 2.2;
        if (this.dist < 11) { vx = -fx * 5; vz = -fz * 5; }
        this.tL.set(2.2, 4.2, 2.2); this.tR.set(-2.2, 4.2, 2.2);
        const bursts = P >= 3 ? 4 : 3;
        if (t > 0.7 + this.count * 0.62 && this.count < bursts) {
          this.count++;
          const n = 5 + (P - 2) * 2;
          const base = yawOf(this.dx, this.dz);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.2 + (this.count % 2) * 0.1;
            const ty = (pl.pos.y + 0.9 - (this.pos.y + 3.5)) / Math.max(4, this.dist);
            c.projectiles.spawnOrb(this.pos.x + Math.sin(a) * 2.4, this.pos.y + 3.5, this.pos.z + Math.cos(a) * 2.4, Math.sin(a), ty, Math.cos(a), 12.5, 13, 0, 0xc070ff, 4);
          }
          c.audio.play('orb');
          this.flash = 0.5;
        }
        if (t > 0.7 + bursts * 0.62 + 0.3) this.setState('recover');
        break;
      }
      case 'charge': {
        const wind = 0.9 / fast;
        if (this.step === 0) {
          this.face(dt, 6);
          this.tL.set(1.6, 2.6, 2.6); this.tR.set(-1.6, 2.6, 2.6);
          vx = -fx * 2.5; vz = -fz * 2.5;
          this.flash = Math.max(this.flash, 0.3 + 0.3 * Math.sin(t * 34));
          if (t > wind) { this.step = 1; this.stateT = 0; this.chargeX = fx; this.chargeZ = fz; c.audio.play('dodge'); c.audio.play('roar', 0.4); }
        } else if (this.step === 1) {
          vx = this.chargeX * 27; vz = this.chargeZ * 27;
          hover = 0.1;
          c.particles.emit({ n: 3, x: this.pos.x, y: this.pos.y + 2, z: this.pos.z, spread: 2, life: 0.5, size: 0.34, color: 0xc9a8ff, color2: 0x6030c0 });
          if (!this.didHit && this.dist < 3.3 && pl.pos.y - this.home.y < 3) { this.didHit = true; this.hitPlayer(28 + P * 2, 16); }
          const hd = Math.hypot(this.pos.x + vx * dt - this.home.x, this.pos.z + vz * dt - this.home.z);
          if (t > 0.62 || hd > this.arenaR - 3) this.setState('recover');
        }
        break;
      }
      case 'storm': {
        this.face(dt, 3);
        hover = 2.6;
        this.tL.set(3.4, 6, 0); this.tR.set(-3.4, 6, 0);
        if (t > 0.5 + this.count * 0.3 && this.count < 11) {
          this.count++;
          let sx: number, sz: number;
          if (this.count % 3 === 1) { sx = pl.pos.x + pl.vel.x * 0.5; sz = pl.pos.z + pl.vel.z * 0.5; }
          else { const a = Math.random() * TAU, r = 2.5 + Math.random() * 8; sx = pl.pos.x + Math.cos(a) * r; sz = pl.pos.z + Math.sin(a) * r; }
          c.projectiles.spawnStrike(sx, this.home.y, sz, 2.7, 0.95, 20, 0xc9a8ff);
        }
        if (t > 0.5 + 11 * 0.3 + 0.8) this.setState('recover');
        break;
      }
      case 'recover':
        hover = -0.3;
        this.tL.set(2.6, 0.6, 1.4); this.tR.set(-2.6, 0.6, 1.4);
        this.setCore(5);
        if (t > 1.7 - P * 0.2) { this.setCore(2); this.cd = Math.max(0.35, 1.3 - P * 0.3) + Math.random() * 0.5; this.setState('chase'); }
        break;
      case 'dying': {
        this.dyingT += dt;
        hover = 1 + this.dyingT * 0.8;
        this.tL.set(3.6, 4, 0); this.tR.set(-3.6, 4, 0);
        this.flash = 0.5 + 0.5 * Math.sin(this.dyingT * 30);
        this.group.rotation.z = Math.sin(this.dyingT * 40) * 0.04;
        if (Math.random() < dt * 14) {
          const ox = (Math.random() - 0.5) * 4, oy = 1 + Math.random() * 5, oz = (Math.random() - 0.5) * 3;
          c.fx.burst(this.pos.x + ox, this.pos.y + oy, this.pos.z + oz, 0.3, 2.2, 0.3, 0xffe0a0, 0.9);
          c.particles.emit({ n: 14, x: this.pos.x + ox, y: this.pos.y + oy, z: this.pos.z + oz, speed: 7, life: 0.7, size: 0.26, color: 0xffffff, color2: 0xc9a8ff });
          c.audio.play('hitHeavy', 0.6); c.cam.shake(0.25);
        }
        if (this.dyingT > 2.6) {
          this.defeated = true;
          this.group.rotation.z = 0;
          c.flash(1); c.cam.shake(1);
          c.audio.play('thunder');
          c.fx.pillar(this.pos.x, this.home.y, this.pos.z, 4, 40, 2.2, 0xffe9c0);
          c.fx.ring(this.pos.x, this.home.y + 0.5, this.pos.z, 1, 26, 1.4, 0xffe9c0);
          c.particles.emit({ n: 160, x: this.pos.x, y: this.pos.y + 3, z: this.pos.z, spread: 2, speed: 14, life: 1.8, size: 0.34, color: 0xffffff, color2: 0xc9a8ff, drag: 1.2, gravity: 3 });
          super.die();
          c.onBossDefeated();
        }
        break;
      }
    }

    // 移动（限制在竞技场内）
    let nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    const hx = nx - this.home.x, hz = nz - this.home.z;
    const hd = Math.hypot(hx, hz);
    const lim = this.arenaR - 3;
    if (hd > lim) { nx = this.home.x + (hx / hd) * lim; nz = this.home.z + (hz / hd) * lim; }
    this.pos.x = nx; this.pos.z = nz;
    this.pos.y = damp(this.pos.y, this.home.y + hover, 5, dt);
    const k = 1 - Math.exp(-(this.state === 'sweep' ? 30 : 11) * dt);
    this.fistL.position.lerp(this.tL, k);
    this.fistR.position.lerp(this.tR, k);
    this.fistL.rotation.y += dt * 0.3;
    if (this.started && this.alive) c.ui.setBoss(BOSS_NAME, clamp01(this.hp / this.maxHp), this.phase);
  }

  protected sync() {
    super.sync();
    this.hitPos.y = this.pos.y + 2.6;
  }
}
