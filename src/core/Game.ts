/**
 * 游戏主控：状态机（菜单 / 游玩 / 暂停 / 死亡 / 通关）、固定子步循环、系统装配与资源生命周期。
 */
import * as THREE from 'three';
import type { Ctx } from './Context';
import { Physics } from './Physics';
import { Input } from './Input';
import { AudioSys, type MusicMood } from './Audio';
import { clearSave, loadSave, loadSettings, newSave, writeSave, writeSettings, type AbilityId, type SaveData, type Settings } from './Save';
import { damp } from './math';
import { Renderer } from '../gfx/Renderer';
import { Sky, type ZoneId } from '../gfx/Sky';
import { Particles } from '../gfx/Particles';
import { Effects } from '../gfx/Effects';
import { CameraRig } from '../gfx/CameraRig';
import { Materials } from '../gfx/geo';
import { Player } from '../entities/Player';
import { Projectiles } from '../entities/Projectiles';
import { World, weaponLevelFor, ZONE_NAMES } from '../world/World';
import { buildLevel } from '../world/Level';
import { UI } from '../ui/UI';

type State = 'boot' | 'menu' | 'playing' | 'paused' | 'dead' | 'victory';

const ABILITY_INFO: Record<AbilityId, [string, string, string]> = {
  doubleJump: ['二段跳', '风在脚下凝结成阶。在空中再次按下跳跃键，可以再跃起一次，抵达更高更远的地方。', '空中再按 空格'],
  windBlade: ['风 刃', '挥剑放出一道疾风，可以击中远处的敌人与水晶机关。消耗少量体力。', 'E'],
  glide: ['滑 翔', '展开风之翼，在空中缓缓滑行。配合上升气流可以飞越辽阔的云海。', '空中按住 空格'],
};
const MAX_STEP = 1 / 50;

export class Game {
  private scene = new THREE.Scene();
  private renderer: Renderer;
  private sky: Sky;
  private cam = new CameraRig();
  private input: Input;
  private audio = new AudioSys();
  private particles: Particles;
  private fx: Effects;
  private ui: UI;
  private settings: Settings;
  private ctx: Ctx;
  private state: State = 'boot';
  private raf = 0;
  private last = 0;
  private hitStopT = 0;
  private flashV = 0;
  private damageV = 0;
  private chromaV = 0;
  private lastHp = 0;
  private zone: ZoneId | null = null;
  private mood: MusicMood = 'none';
  private menuT = 0;
  private deadT = -1;
  private victoryT = -1;
  private saveT = 0;
  private perfT = 0;
  private perfN = 0;
  private busy = false;
  private built = false;
  private abort = new AbortController();
  private focus = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.renderer = new Renderer(canvas, this.scene, this.cam.camera);
    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene);
    this.fx = new Effects(this.scene);
    this.input = new Input(canvas);
    this.ui = new UI({
      newGame: () => void this.start(true),
      continueGame: () => void this.start(false),
      resume: () => this.resume(),
      retry: () => void this.retry(),
      toMenu: () => void this.toMenu(),
      settingsChanged: (s) => this.applySettings(s),
      click: (back) => { this.audio.unlock(); this.audio.play(back ? 'uiBack' : 'ui'); },
    });
    this.ui.camera = this.cam.camera;
    this.ui.setSettings(this.settings);

    const g = this;
    // ctx 的各系统字段在 build() 中填充；Thing / Enemy 持有的是同一个对象引用
    this.ctx = {
      scene: this.scene, input: this.input, audio: this.audio, particles: this.particles, fx: this.fx, cam: this.cam,
      settings: this.settings, ui: this.ui, time: 0,
      physics: null!, mats: null!, save: null!, player: null!, world: null!, projectiles: null!,
      hitStop: (s) => { g.hitStopT = Math.max(g.hitStopT, s); },
      saveGame: () => g.persist(),
      hasFlag: (f) => g.ctx.save.flags.includes(f),
      setFlag: (f) => { if (!g.ctx.save.flags.includes(f)) g.ctx.save.flags.push(f); },
      isCollected: (id) => g.ctx.save.collected.includes(id),
      collect: (id) => { if (!g.ctx.save.collected.includes(id)) g.ctx.save.collected.push(id); },
      unlockAbility: (a) => g.unlockAbility(a),
      setCheckpoint: (id) => { g.ctx.save.checkpoint = id; g.persist(); },
      onPlayerDeath: () => g.onPlayerDeath(),
      onBossDefeated: () => g.onBossDefeated(),
      flash: (a) => { g.flashV = Math.max(g.flashV, a); },
    };

    this.sky.onThunder = () => { if (this.state === 'playing') this.audio.play('thunder', 0.5); };
    this.input.onLockLost = () => { if (this.state === 'playing' && this.ui.screen === 'none') this.pause(); };
    const o = { signal: this.abort.signal };
    window.addEventListener('resize', () => this.renderer.resize(), o);
    window.addEventListener('blur', () => { if (this.state === 'playing' && this.ui.screen === 'none') this.pause(); }, o);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing' && this.ui.screen === 'none') this.pause(); }, o);
    window.addEventListener('beforeunload', () => { if (this.built && this.state !== 'menu') writeSave(this.ctx.save); }, o);
    window.addEventListener('pointerdown', () => this.audio.unlock(), o);
    window.addEventListener('keydown', () => this.audio.unlock(), o);
  }

  async init() {
    await Physics.init();
    this.applySettings(this.settings);
    this.build(loadSave() ?? newSave());
    this.enterMenu();
    this.ui.fade(false);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 菜单背景场景不产生存档 */
  private persist() { if (this.state !== 'menu' && this.state !== 'boot') writeSave(this.ctx.save); }

  private applySettings(s: Settings) {
    this.settings = s;
    this.ctx.settings = s;
    writeSettings(s);
    this.renderer.applySettings(s);
    this.sky.setShadowSize(this.renderer.shadowSize);
    this.sky.sun.castShadow = s.shadows;
    this.audio.applySettings(s);
    this.ui.setSettings(s);
  }

  // ============================================================ 世界装配 / 销毁
  private build(save: SaveData) {
    this.teardown();
    const c = this.ctx;
    c.save = save;
    c.time = 0;
    c.mats = new Materials();
    c.physics = new Physics();
    c.world = new World(c);
    c.player = new Player(c);
    c.projectiles = new Projectiles(c);
    buildLevel(c, c.world);
    c.player.weaponLevel = weaponLevelFor(save.shards);
    this.spawnAtCheckpoint();
    c.physics.step(1 / 60);
    this.built = true;
  }
  private teardown() {
    if (!this.built) return;
    const c = this.ctx;
    this.built = false;
    this.particles.clear();
    this.fx.clear();
    c.projectiles.dispose();
    c.world.dispose();
    c.player.dispose();
    c.physics.dispose();
    c.mats.dispose();
  }
  private spawnAtCheckpoint() {
    const c = this.ctx;
    const cp = c.world.checkpoints.get(c.save.checkpoint) ?? c.world.checkpoints.get('cp_start')!;
    c.player.revive(true);
    c.player.teleport(cp.x, cp.y + 0.2, cp.z, cp.facing);
    this.cam.snapTo(c.player.pos, cp.facing + Math.PI + 0.9); // 偏转，避免风之碑挡在镜头前
    this.lastHp = c.player.hp;
    this.zone = null;
    this.hitStopT = 0;
    this.deadT = this.victoryT = -1;
  }

  // ============================================================ 状态切换
  private enterMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.cam.cinematic = true;
    this.ui.hasSave = loadSave() !== null;
    this.ui.resetHud();
    this.ui.show('menu');
    this.sky.setZone('meadow', true);
    this.zone = null;
    this.setMood('menu');
  }
  private async start(fresh: boolean) {
    if (this.busy) return;
    this.busy = true;
    this.audio.unlock();
    this.input.requestLock();
    await this.ui.transition(() => {
      if (fresh) { clearSave(); this.build(newSave()); writeSave(this.ctx.save); }
      else this.build(loadSave() ?? newSave());
      this.ui.resetHud();
      this.ui.show('none');
      this.cam.cinematic = false;
      this.input.clear();
      this.input.enabled = true;
      this.state = 'playing';
      this.updateZone(true);
      if (fresh) this.ui.toast('点击画面可锁定鼠标 · Esc 暂停', 'info', 6);
    });
    this.busy = false;
  }
  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.exitLock();
    this.input.clear();
    this.ui.show('pause');
    this.audio.play('uiBack');
  }
  private resume() {
    if (this.state === 'victory') { this.victoryT = -1; this.cam.cinematic = false; }
    else if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.show('none');
    this.input.clear();
    this.input.enabled = true;
    this.input.requestLock();
  }
  private async retry() {
    if (this.busy || this.state !== 'dead') return;
    this.busy = true;
    this.input.requestLock();
    await this.ui.transition(() => {
      const c = this.ctx;
      c.projectiles.clear();
      this.fx.clear();
      c.world.resetEncounters();
      this.spawnAtCheckpoint();
      this.ui.resetHud();
      this.ui.show('none');
      this.input.clear();
      this.input.enabled = true;
      this.state = 'playing';
      this.updateZone(true);
    });
    this.busy = false;
  }
  private async toMenu() {
    if (this.busy) return;
    this.busy = true;
    await this.ui.transition(() => {
      // 进度以最近的风之碑为准；收集与能力即时保存
      if (this.built) writeSave(this.ctx.save);
      this.build(loadSave() ?? newSave());
      this.enterMenu();
    });
    this.busy = false;
  }
  private onPlayerDeath() {
    this.ctx.save.deaths++;
    writeSave(this.ctx.save);
    this.deadT = 1.6;
    this.audio.play('death');
    this.setMood('none');
  }
  private onBossDefeated() {
    const s = this.ctx.save;
    s.bossDefeated = true;
    writeSave(s);
    this.victoryT = 4.2;
    this.audio.play('victory');
    this.setMood('none');
    this.sky.setZone('meadow');
  }
  private unlockAbility(a: AbilityId) {
    const c = this.ctx;
    c.save.abilities[a] = true;
    writeSave(c.save);
    this.audio.play('ability');
    this.flashV = 0.6;
    const [title, desc, key] = ABILITY_INFO[a];
    this.ui.abilityCard(title, desc, key);
    this.updateObjective();
  }
  private setMood(m: MusicMood) { if (m !== this.mood) { this.mood = m; this.audio.setMood(m); } }

  private updateObjective() {
    const s = this.ctx.save;
    this.ui.setObjective(
      !s.abilities.doubleJump ? '向北穿过启程岛，前往牧风丘的风之祭坛'
        : !s.abilities.windBlade ? '登上落日遗迹，解开符文之谜，前往西侧的风刃神殿'
        : !s.abilities.glide ? '跨过光桥抵达霜原，点亮三颗风之水晶，乘气流登上极光台'
        : !s.bossDefeated ? '从极光台向北滑翔至风暴祭坛，击败苍穹守卫'
        : '风暴已经平息。自由探索群岛，寻找剩余的远古遗物');
  }
  private updateZone(instant = false) {
    const c = this.ctx;
    const boss = c.world.boss;
    let z = c.world.zoneAt(c.player.pos.z);
    if (z === 'storm' && c.save.bossDefeated) z = 'meadow'; // 击败 Boss 后风暴散去
    if (z !== this.zone) {
      this.zone = z;
      this.sky.setZone(z, instant);
      const real = c.world.zoneAt(c.player.pos.z);
      this.ui.banner(ZONE_NAMES[real][0], ZONE_NAMES[real][1]);
      this.updateObjective();
    }
    const fighting = !!boss && boss.started && boss.alive;
    if (c.player.alive && this.victoryT < 0) this.setMood(fighting ? 'boss' : c.world.zoneAt(c.player.pos.z));
  }

  // ============================================================ 主循环
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.built) return;
    const c = this.ctx, inp = this.input, p = c.player;
    let simulating = false;

    // ---- 全局按键
    if (inp.wasPressed('pause')) {
      if (this.ui.back()) { /* 子界面返回 */ }
      else if (this.state === 'playing' && this.ui.screen === 'none') this.pause();
      else if (this.state === 'paused' && this.ui.screen === 'pause') this.resume();
    }

    if (this.state === 'menu') {
      this.menuT += dt;
      p.frozen = 1;
      this.simulate(dt, false);
      this.cam.orbit(this.focus.set(0, 1.5, 2), 30, 9.5, this.menuT * 0.05 + 0.5, 3.5);
    } else if (this.state === 'playing' || this.state === 'dead' || this.state === 'victory') {
      if (this.ui.screen === 'card') {
        // 能力卡片：暂停模拟，等待确认
        if (this.ui.cardOpenT > 0.7 && (inp.wasPressed('jump') || inp.wasPressed('interact') || inp.wasPressed('attack') || inp.keyPressed('Enter'))) {
          this.ui.show('none');
          this.audio.play('ui');
          inp.clear();
        }
        this.particles.update(dt, this.cam.camera, window.innerHeight);
        this.fx.update(dt);
      } else if (this.state !== 'victory' || this.victoryT >= 0) {
        simulating = true;
        if (this.hitStopT > 0) {
          this.hitStopT -= dt;
          this.cam.update(dt, p.pos, inp, this.settings, c.physics, 0);
        } else {
          this.simulate(dt, true);
          this.cam.update(dt, p.pos, this.state === 'playing' ? inp : null, this.settings, c.physics, p.sprinting ? 1 : 0);
        }
        this.updateZone();
        // 受击后期反馈
        if (p.hp < this.lastHp - 0.5) { this.damageV = 1; this.chromaV = 1; }
        this.lastHp = p.hp;
        c.save.playTime += dt;
        this.saveT += dt;
        if (this.saveT > 20 && p.alive) { this.saveT = 0; writeSave(c.save); }
        if (this.deadT >= 0 && (this.deadT -= dt) < 0 && this.state === 'playing') {
          this.state = 'dead';
          this.input.enabled = false;
          this.input.exitLock();
          this.ui.show('dead');
        }
        if (this.victoryT >= 0 && (this.victoryT -= dt) < 0 && p.alive) {
          this.state = 'victory';
          this.input.enabled = false;
          this.input.exitLock();
          const s = c.save;
          this.ui.stats = { time: s.playTime, deaths: s.deaths, kills: s.kills, shards: s.shards, shardTotal: c.world.totals.shard, relics: s.collected.filter((k) => k.startsWith('relic_')).length, relicTotal: c.world.totals.relic };
          this.ui.show('victory');
          this.setMood('meadow');
        }
      }
    }
    // state === 'paused'：画面定格

    if (this.state !== 'paused') {
      this.sky.update(dt, p.pos, this.cam.camera);
      this.audio.update();
    }
    // ---- 后期参数
    const r = this.renderer;
    this.flashV = damp(this.flashV, 0, 5, dt);
    this.damageV = damp(this.damageV, 0, 2.2, dt);
    this.chromaV = damp(this.chromaV, 0, 6, dt);
    r.fx.time += dt;
    r.fx.flash = Math.min(1, this.flashV + this.sky.flash * 0.12);
    r.fx.damage = this.damageV;
    r.fx.chroma = this.chromaV;
    r.fx.lowHp = this.state === 'menu' || !p.alive ? 0 : Math.max(0, 1 - p.hp / (p.maxHp * 0.3));
    r.fx.bloom = this.sky.cur.bloom;
    r.renderer.toneMappingExposure = this.sky.cur.exposure;
    this.ui.update(dt, c, simulating);
    if (simulating && this.state === 'playing') this.watchPerf(dt);
    r.render();
    inp.endFrame();
  };

  /** 连续数秒低于 30 FPS 时逐级降画质（高 → 中 → 低 → 关闭后期），每级只降一次并提示玩家 */
  private watchPerf(dt: number) {
    const s = this.settings;
    if (!s.autoQuality || document.hidden) { this.perfT = this.perfN = 0; return; }
    this.perfT += dt;
    this.perfN++;
    if (this.perfT < 4) return;
    const fps = this.perfN / this.perfT;
    this.perfT = this.perfN = 0;
    if (fps >= 30) return;
    if (s.quality === 'high') s.quality = 'medium';
    else if (s.quality === 'medium') s.quality = 'low';
    else if (s.postfx) s.postfx = false;
    else return;
    this.applySettings(s);
    this.ui.toast('帧率偏低，已自动降低画质（可在设置中调整）');
  }

  /** 固定上限的子步模拟 */
  private simulate(dt: number, withInput: boolean) {
    const c = this.ctx;
    const n = Math.min(5, Math.max(1, Math.ceil(dt / MAX_STEP)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      c.time += h;
      c.world.update(h);
      c.player.update(h);
      c.projectiles.update(h);
      c.physics.step(h);
      // 瞬时按键只在第一个子步生效，避免一次按键被多次消费
      if (i === 0 && n > 1 && withInput) this.input.consumePresses();
    }
    this.particles.update(dt, this.cam.camera, window.innerHeight);
    this.fx.update(dt);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.teardown();
    this.input.dispose();
    this.ui.dispose();
    this.fx.dispose();
    this.particles.dispose();
    this.sky.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
