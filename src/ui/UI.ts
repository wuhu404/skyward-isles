/**
 * DOM 界面层：主菜单 / 暂停 / 设置 / 操作说明 / HUD / 死亡 / 通关 / 能力卡片 / 转场。
 * 所有按钮都通过 UIActions 回调接入真实的游戏逻辑。
 */
import * as THREE from 'three';
import './style.css';
import type { Ctx, UIHooks } from '../core/Context';
import type { Quality, Settings } from '../core/Save';
import { WEAPON_NAMES, WEAPON_THRESHOLDS } from '../world/World';

export type Screen = 'loading' | 'menu' | 'pause' | 'settings' | 'help' | 'dead' | 'victory' | 'card' | 'confirm' | 'unstuck' | 'none';

export interface UIActions {
  newGame(): void;
  continueGame(): void;
  resume(): void;
  retry(): void;
  /** 已唤醒、可传送的风之碑（按旅途顺序） */
  unstuckTargets(): { id: string; name: string; current: boolean }[];
  unstuck(id: string): void;
  toMenu(): void;
  settingsChanged(s: Settings): void;
  click(back?: boolean): void;
}
export interface VictoryStats { time: number; deaths: number; kills: number; shards: number; shardTotal: number; relics: number; relicTotal: number; }

const ICONS = {
  doubleJump: '<svg viewBox="0 0 24 24"><path d="M5 13l7-7 7 7M5 20l7-7 7 7"/></svg>',
  windBlade: '<svg viewBox="0 0 24 24"><path d="M4 18C6 9 12 5 20 4c-3 3-4 6-4 10-3-2-7-1-12 4z"/></svg>',
  glide: '<svg viewBox="0 0 24 24"><path d="M2 10c4-5 16-5 20 0-3-1-5 0-6 2-2-2-6-2-8 0-1-2-3-3-6-2zM12 12v7"/></svg>',
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

interface Dmg { el: HTMLDivElement; t: number; life: number; pos: THREE.Vector3; ox: number; }

export class UI implements UIHooks {
  screen: Screen = 'loading';
  private root: HTMLElement;
  private layer: HTMLElement;
  private hud: HTMLElement;
  private fadeEl: HTMLElement;
  private abort = new AbortController();
  private returnTo: Screen = 'menu';
  private settings!: Settings;
  private q: Record<string, HTMLElement> = {};
  private dmg: Dmg[] = [];
  private v = new THREE.Vector3();
  private cache: Record<string, string | number | boolean> = {};
  private bannerEl: HTMLElement | null = null;
  private bannerQueue: [string, string][] = [];
  private bannerT = 0;
  private dialogT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  cardOpenT = 0;
  hasSave = false;
  bossDefeated = false;
  stats: VictoryStats | null = null;
  private card = { title: '', desc: '', key: '' };
  camera: THREE.PerspectiveCamera | null = null;

  constructor(private actions: UIActions) {
    this.root = document.getElementById('ui')!;
    this.hud = el(`<div id="hud" class="off">
      <div class="vitals">
        <div class="bar hp" data-q="hpBar"><i class="lag" data-q="hpLag"></i><i class="fill" data-q="hpFill"></i></div>
        <div class="bar st" data-q="stBar"><i class="fill" data-q="stFill"></i></div>
        <div class="hpnum" data-q="hpNum"></div>
        <div class="potions" data-q="potions"></div>
      </div>
      <div class="objective"><span>当前目标</span><em data-q="objective" style="font-style:normal"></em></div>
      <div class="loot">
        <div><i class="gem"></i><b data-q="shards" style="font-weight:400">0</b></div>
        <div><i class="gem relic"></i><b data-q="relics" style="font-weight:400">0</b></div>
        <div class="weapon" data-q="weapon"></div>
        <div><small data-q="weaponNext"></small></div>
      </div>
      <div class="toasts" data-q="toasts"></div>
      <div class="boss hidden" data-q="boss"><div class="name" data-q="bossName"></div>
        <div class="bar"><i class="lag" data-q="bossLag"></i><i class="fill" data-q="bossFill"></i></div>
        <div class="pips" data-q="bossPips"><i></i><i></i><i></i></div></div>
      <div class="cross"></div>
      <div class="prompt hidden" data-q="prompt"></div>
      <div class="dialog hidden" data-q="dialog"></div>
      <div class="abilities">
        <div class="ab locked" data-q="ab_doubleJump">${ICONS.doubleJump}<kbd>空格×2</kbd></div>
        <div class="ab locked" data-q="ab_windBlade">${ICONS.windBlade}<i class="cd" data-q="bladeCd"></i><kbd>E</kbd></div>
        <div class="ab locked" data-q="ab_glide">${ICONS.glide}<kbd>按住空格</kbd></div>
      </div>
      <div class="fps hidden" data-q="fps"></div>
      <div data-q="dmgLayer"></div>
    </div>`);
    this.layer = el('<div style="position:absolute;inset:0"></div>');
    this.fadeEl = el('<div id="fade" class="on"></div>');
    this.root.append(this.hud, this.layer, this.fadeEl);
    this.hud.querySelectorAll<HTMLElement>('[data-q]').forEach((e) => (this.q[e.dataset.q!] = e));
    for (let i = 0; i < 24; i++) {
      const d = el<HTMLDivElement>('<div class="dmg hidden"></div>');
      this.q.dmgLayer.append(d);
      this.dmg.push({ el: d, t: 0, life: 0, pos: new THREE.Vector3(), ox: 0 });
    }
    // 统一的按钮事件委托
    this.layer.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.onAct(b.dataset.act!, b);
    }, { signal: this.abort.signal });
    this.layer.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.set) this.onSlider(t);
    }, { signal: this.abort.signal });
    this.show('loading');
  }

  setSettings(s: Settings) { this.settings = s; this.q.fps.classList.toggle('hidden', !s.showFps); }

  // ============================================================ 界面切换
  show(s: Screen) {
    this.screen = s;
    this.layer.innerHTML = '';
    this.hud.classList.toggle('off', !(s === 'none' || s === 'card'));
    if (s === 'none') return;
    this.layer.append(el(this.template(s)));
    this.layer.querySelector<HTMLElement>('.btn:not(:disabled)')?.focus({ preventScroll: true });
    if (s === 'card') this.cardOpenT = 0;
  }
  private template(s: Screen): string {
    switch (s) {
      case 'loading':
        return `<div class="screen loading"><h1 class="title" style="font-size:44px">云垣遗歌</h1><div class="bar"><i></i></div></div>`;
      case 'menu':
        return `<div class="screen menu">
          <h1 class="title">云垣遗歌</h1><div class="subtitle">Skyward Isles</div>
          ${matchMedia('(hover: none) and (pointer: coarse)').matches ? '<p class="notice">检测到触屏设备：本游戏目前只支持键盘和鼠标操作，请在电脑浏览器中打开游玩。</p>' : ''}
          <div class="btns">
            <button class="btn" data-act="continue" ${this.hasSave ? '' : 'disabled'}>继续旅程${this.hasSave ? '' : '<small>暂无存档</small>'}</button>
            <button class="btn" data-act="${this.hasSave ? 'confirmNew' : 'new'}">新的旅程</button>
            <button class="btn" data-act="settings">设置</button>
            <button class="btn" data-act="help">操作说明</button>
          </div>
          <div class="foot">Three.js · Rapier · 全程序化生成 ｜ 建议使用键盘与鼠标游玩</div></div>`;
      case 'confirm':
        return `<div class="screen dim center"><div class="h2" style="font-size:28px">开始新的旅程？</div>
          <p class="lead">现有存档将被覆盖，此操作无法撤销。</p>
          <div class="btns"><button class="btn" data-act="new">确认，重新开始</button><button class="btn" data-act="back">返回</button></div></div>`;
      case 'pause':
        return `<div class="screen dim center"><div class="h2">暂 停</div><p class="lead">在风之碑休息可以存档并恢复状态</p>
          <div class="btns">
            <button class="btn" data-act="resume">继续游戏</button>
            <button class="btn" data-act="settings">设置</button>
            <button class="btn" data-act="help">操作说明</button>
            <button class="btn" data-act="unstuckMenu">脱离卡死<small>卡住或无法前进时，传送回风之碑</small></button>
            <button class="btn" data-act="menu">返回主菜单<small>进度保存在最近的风之碑</small></button>
          </div></div>`;
      case 'unstuck':
        return `<div class="screen dim center"><div class="h2">脱离卡死</div>
          <p class="lead">选择一座已唤醒的风之碑，风会把你送回那里。<br>能力、收集品和已解开的机关都会保留；敌人与可推动的石块会回到原位。</p>
          <div class="btns cols">
            ${this.actions.unstuckTargets().map((t) => `<button class="btn" data-act="unstuck" data-id="${t.id}">${t.name}${t.current ? '<small>最近休息的风之碑</small>' : ''}</button>`).join('')}
            <button class="btn wide" data-act="back">返回</button>
          </div></div>`;
      case 'dead':
        return `<div class="screen dim center"><div class="h2 red">旅途中断</div><p class="lead">风会将你带回最近的风之碑。</p>
          <div class="btns"><button class="btn" data-act="retry">从风之碑重试</button><button class="btn" data-act="menu">返回主菜单</button></div></div>`;
      case 'victory': {
        const s2 = this.stats!;
        return `<div class="screen dim center"><div class="h2 gold">云 垣 重 光</div>
          <p class="lead">苍穹守卫化作星辉散去，风暴平息，群岛的天空再度澄澈。<br>感谢游玩。</p>
          <div class="stats">
            <div><span>通关用时</span><b>${fmtTime(s2.time)}</b></div>
            <div><span>倒下次数</span><b>${s2.deaths}</b></div>
            <div><span>击败敌人</span><b>${s2.kills}</b></div>
            <div><span>星辉碎片</span><b>${s2.shards}/${s2.shardTotal}</b></div>
            <div><span>远古遗物</span><b>${s2.relics}/${s2.relicTotal}</b></div>
          </div>
          <div class="btns"><button class="btn" data-act="resume">继续探索群岛</button><button class="btn" data-act="menu">返回主菜单</button></div></div>`;
      }
      case 'card':
        return `<div class="screen dim center" style="pointer-events:none"><div class="card"><span>获得新能力</span><h3>${this.card.title}</h3>
          <p>${this.card.desc}</p><p><kbd>${this.card.key}</kbd></p><em>按 空格 / F / 鼠标左键 继续</em></div></div>`;
      case 'help':
        return `<div class="screen dim"><div class="panel"><h3>操作说明</h3>
          <div class="keys">
            <b>W A S D</b><span>移动</span><b>鼠标 / 方向键</b><span>转动视角</span>
            <b>空格</b><span>跳跃（空中再按：二段跳）</span><b>按住空格</b><span>空中滑翔</span>
            <b>Shift</b><span>冲刺（消耗体力）</span><b>右键 / Q</b><span>翻滚闪避（无敌帧）</span>
            <b>左键 / J</b><span>挥剑，连按三连击</span><b>E</b><span>风刃（朝准星方向）</span>
            <b>F</b><span>互动 / 休息 / 开箱</span><b>R</b><span>饮用治疗药水</span>
            <b>滚轮</b><span>调整镜头距离</span><b>Esc / P</b><span>暂停</span>
          </div>
          <ul class="tips">
            <li>敌人出招前会有红色预警圈或闪光，翻滚的无敌帧可以穿过大多数攻击。</li>
            <li>石像卫士与 Boss 在出招后会进入硬直，核心发亮时伤害提高 50%。</li>
            <li>贴地扩散的冲击波可以直接跳过去。</li>
            <li>星辉碎片累计到 ${WEAPON_THRESHOLDS.join(' / ')} 枚时武器会升级；遗物藏在需要绕路或新能力才能到达的地方。</li>
          </ul>
          <div class="btns"><button class="btn" data-act="back">返回</button></div></div></div>`;
      case 'settings': {
        const s3 = this.settings;
        const seg = (k: string, opts: [string, string][], cur: string) => `<div class="seg">${opts.map(([v, n]) => `<button data-act="seg" data-k="${k}" data-v="${v}" class="${v === cur ? 'on' : ''}">${n}</button>`).join('')}</div>`;
        const tog = (k: keyof Settings) => `<button class="tog ${s3[k] ? 'on' : ''}" data-act="tog" data-k="${k}">${s3[k] ? '开启' : '关闭'}</button>`;
        const rng = (k: keyof Settings, min: number, max: number, step: number, f: string) => `<input type="range" data-set="${k}" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${s3[k]}"><output>${this.fmt(s3[k] as number, f)}</output>`;
        return `<div class="screen dim"><div class="panel"><h3>设 置</h3>
          <div class="row"><span>画面质量</span>${seg('quality', [['low', '低'], ['medium', '中'], ['high', '高']], s3.quality)}<output></output></div>
          <div class="row"><span>动态阴影</span><div>${tog('shadows')}</div><output></output></div>
          <div class="row"><span>后期处理</span><div>${tog('postfx')}</div><output></output></div>
          <div class="row"><span>视野范围</span>${rng('fov', 45, 80, 1, 'deg')}</div>
          <div class="row"><span>鼠标灵敏度</span>${rng('sensitivity', 0.3, 2.5, 0.05, 'x')}</div>
          <div class="row"><span>反转 Y 轴</span><div>${tog('invertY')}</div><output></output></div>
          <div class="row"><span>镜头震动</span>${rng('shake', 0, 1.5, 0.05, 'pct')}</div>
          <div class="row"><span>主音量</span>${rng('master', 0, 1, 0.01, 'pct')}</div>
          <div class="row"><span>音乐音量</span>${rng('music', 0, 1, 0.01, 'pct')}</div>
          <div class="row"><span>音效音量</span>${rng('sfx', 0, 1, 0.01, 'pct')}</div>
          <div class="row"><span>显示帧率</span><div>${tog('showFps')}</div><output></output></div>
          <div class="row"><span>卡顿时自动降画质</span><div>${tog('autoQuality')}</div><output></output></div>
          <div class="btns"><button class="btn" data-act="back">返回</button></div></div></div>`;
      }
      default: return '<div></div>';
    }
  }
  private fmt(v: number, f: string) { return f === 'pct' ? Math.round(v * 100) + '%' : f === 'deg' ? v + '°' : v.toFixed(2) + '×'; }

  private onAct(act: string, b: HTMLElement) {
    const a = this.actions;
    switch (act) {
      case 'new': a.click(); a.newGame(); break;
      case 'confirmNew': a.click(); this.returnTo = 'menu'; this.show('confirm'); break;
      case 'continue': a.click(); a.continueGame(); break;
      case 'resume': a.click(); a.resume(); break;
      case 'retry': a.click(); a.retry(); break;
      case 'menu': a.click(true); a.toMenu(); break;
      case 'settings': case 'help': a.click(); this.returnTo = this.screen; this.show(act); break;
      case 'unstuckMenu': a.click(); this.returnTo = this.screen; this.show('unstuck'); break;
      case 'unstuck': a.click(); a.unstuck(b.dataset.id!); break;
      case 'back': a.click(true); this.show(this.returnTo); break;
      case 'seg': {
        this.settings.quality = b.dataset.v as Quality;
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        a.click(); a.settingsChanged(this.settings);
        break;
      }
      case 'tog': {
        const k = b.dataset.k as 'shadows' | 'postfx' | 'invertY' | 'showFps' | 'autoQuality';
        this.settings[k] = !this.settings[k];
        b.classList.toggle('on', this.settings[k]);
        b.textContent = this.settings[k] ? '开启' : '关闭';
        a.click(); a.settingsChanged(this.settings);
        this.q.fps.classList.toggle('hidden', !this.settings.showFps);
        break;
      }
    }
  }
  private onSlider(t: HTMLInputElement) {
    const k = t.dataset.set as 'fov' | 'sensitivity' | 'shake' | 'master' | 'music' | 'sfx';
    this.settings[k] = parseFloat(t.value);
    (t.nextElementSibling as HTMLElement).textContent = this.fmt(this.settings[k], t.dataset.f!);
    this.actions.settingsChanged(this.settings);
  }
  /** Esc 在子界面中的行为；返回 true 表示已处理 */
  back(): boolean {
    if (this.screen === 'settings' || this.screen === 'help' || this.screen === 'confirm') { this.actions.click(true); this.show(this.returnTo); return true; }
    return false;
  }

  // ============================================================ 转场
  fade(on: boolean) { this.fadeEl.classList.toggle('on', on); }
  /** 黑场 → 执行 → 淡入 */
  async transition(fn: () => void | Promise<void>, hold = 0.15) {
    this.fade(true);
    await new Promise((r) => setTimeout(r, 480));
    await fn();
    await new Promise((r) => setTimeout(r, hold * 1000));
    this.fade(false);
  }

  // ============================================================ UIHooks
  toast(text: string, kind: 'info' | 'good' | 'item' = 'info', seconds = 3.2) {
    const box = this.q.toasts;
    const t = el(`<div class="toast ${kind}"></div>`);
    t.textContent = text;
    box.append(t);
    while (box.children.length > 5) box.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), seconds * 1000);
    setTimeout(() => t.remove(), seconds * 1000 + 450);
  }
  banner(title: string, sub = '') {
    if (this.bannerQueue.some((b) => b[0] === title)) return;
    this.bannerQueue.push([title, sub]);
  }
  dialog(text: string, seconds = 8) {
    this.q.dialog.textContent = text;
    this.q.dialog.classList.remove('hidden');
    this.dialogT = seconds;
  }
  damageNumber(pos: THREE.Vector3, amount: number, kind: 'enemy' | 'player' | 'heal' | 'crit') {
    const d = this.dmg.find((k) => k.t >= k.life) ?? this.dmg[0];
    d.t = 0; d.life = kind === 'crit' ? 0.9 : 0.7;
    d.pos.copy(pos); d.pos.y += 0.5;
    d.ox = (Math.random() - 0.5) * 50;
    d.el.className = 'dmg ' + kind;
    d.el.textContent = (kind === 'heal' ? '+' : '') + Math.round(amount);
  }
  setPrompt(text: string | null) {
    if (this.cache.prompt === (text ?? '')) return;
    this.cache.prompt = text ?? '';
    this.q.prompt.classList.toggle('hidden', !text);
    if (text) this.q.prompt.innerHTML = `<kbd>F</kbd>${text}`;
  }
  setObjective(text: string) { this.set('objective', text); }
  setBoss(name: string | null, frac = 1, phase = 1) {
    const on = !!name;
    if (this.cache.bossOn !== on) { this.cache.bossOn = on; this.q.boss.classList.toggle('hidden', !on); }
    if (!on) return;
    this.set('bossName', name!);
    const f = Math.round(frac * 500) / 500;
    if (this.cache.bossF !== f) { this.cache.bossF = f; this.q.bossFill.style.transform = this.q.bossLag.style.transform = `scaleX(${f})`; }
    if (this.cache.bossP !== phase) { this.cache.bossP = phase; [...this.q.bossPips.children].forEach((c, i) => c.classList.toggle('on', i < 4 - phase)); }
  }
  abilityCard(title: string, desc: string, key: string) {
    this.card = { title, desc, key };
    this.show('card');
  }

  private set(k: string, text: string) {
    if (this.cache[k] === text) return;
    this.cache[k] = text;
    this.q[k].textContent = text;
  }

  // ============================================================ 每帧
  update(dt: number, ctx: Ctx, simulating: boolean) {
    this.cardOpenT += dt;
    // 横幅队列
    this.bannerT -= dt;
    if (this.bannerT <= 0 && this.bannerQueue.length && (this.screen === 'none')) {
      const [title, sub] = this.bannerQueue.shift()!;
      this.bannerEl?.remove();
      this.bannerEl = el(`<div class="banner"><h4></h4><hr><p></p></div>`);
      this.bannerEl.querySelector('h4')!.textContent = title;
      this.bannerEl.querySelector('p')!.textContent = sub;
      this.hud.append(this.bannerEl);
      this.bannerT = 3.2;
      const b = this.bannerEl;
      setTimeout(() => { b.remove(); if (this.bannerEl === b) this.bannerEl = null; }, 4000);
    }
    if (this.dialogT > 0 && simulating) { this.dialogT -= dt; if (this.dialogT <= 0) this.q.dialog.classList.add('hidden'); }
    if (this.settings?.showFps) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc >= 0.5) {
        this.q.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · 粒子 ${ctx.particles.count}`;
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }
    if (this.screen !== 'none' && this.screen !== 'card') return;
    const p = ctx.player, s = ctx.save, c = this.cache, q = this.q;
    // 生命 / 体力
    const hpW = Math.round(120 + p.maxHp * 1.5), stW = Math.round(90 + p.maxStamina * 1.3);
    if (c.hpW !== hpW) { c.hpW = hpW; q.hpBar.style.width = hpW + 'px'; }
    if (c.stW !== stW) { c.stW = stW; q.stBar.style.width = stW + 'px'; }
    const hf = Math.round(Math.max(0, p.hp / p.maxHp) * 400) / 400;
    if (c.hf !== hf) { c.hf = hf; q.hpFill.style.transform = q.hpLag.style.transform = `scaleX(${hf})`; q.hpBar.classList.toggle('low', hf < 0.3); }
    const sf = Math.round(Math.max(0, p.stamina / p.maxStamina) * 200) / 200;
    if (c.sf !== sf) { c.sf = sf; q.stFill.style.transform = `scaleX(${sf})`; q.stBar.classList.toggle('out', sf < 0.15); }
    this.set('hpNum', `${Math.ceil(p.hp)} / ${p.maxHp}`);
    const pk = p.potions + '/' + s.potionsMax;
    if (c.pk !== pk) {
      c.pk = pk;
      q.potions.innerHTML = Array.from({ length: s.potionsMax }, (_, i) => `<i class="${i < p.potions ? '' : 'empty'}"></i>`).join('') + '<kbd>R</kbd>';
    }
    // 收集
    if (c.shards !== s.shards) {
      c.shards = s.shards; q.shards.textContent = String(s.shards);
      q.shards.classList.remove('bump'); void q.shards.offsetWidth; q.shards.classList.add('bump');
      const next = WEAPON_THRESHOLDS[p.weaponLevel];
      q.weaponNext.textContent = next ? `距下次武器共鸣 ${Math.max(0, next - s.shards)} 枚` : '武器已完全觉醒';
    }
    this.set('weapon', WEAPON_NAMES[p.weaponLevel]);
    const relics = s.collected.reduce((n, k) => n + (k.startsWith('relic_') ? 1 : 0), 0);
    this.set('relics', `${relics} / ${ctx.world.totals.relic}`);
    // 能力
    for (const a of ['doubleJump', 'windBlade', 'glide'] as const) {
      const has = s.abilities[a];
      if (c['ab' + a] !== has) { c['ab' + a] = has; q['ab_' + a].classList.toggle('locked', !has); }
    }
    const cd = Math.round(Math.min(1, p.skillCd / 0.85) * 50) * 2;
    if (c.cd !== cd) {
      if (cd === 0 && (c.cd as number) > 0) { q.ab_windBlade.classList.remove('ready'); void q.ab_windBlade.offsetWidth; q.ab_windBlade.classList.add('ready'); }
      c.cd = cd; q.bladeCd.style.height = cd + '%';
    }
    // 伤害数字
    const cam = this.camera;
    if (cam) {
      const w = window.innerWidth, h = window.innerHeight;
      for (const d of this.dmg) {
        if (d.t >= d.life) continue;
        d.t += dt;
        if (d.t >= d.life) { d.el.classList.add('hidden'); continue; }
        this.v.copy(d.pos).project(cam);
        if (this.v.z > 1) { d.el.classList.add('hidden'); continue; }
        const k = d.t / d.life;
        const x = (this.v.x * 0.5 + 0.5) * w + d.ox * (0.4 + k * 0.6), y = (-this.v.y * 0.5 + 0.5) * h - 30 - k * 46;
        const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.7 : 1.3 - Math.min(1, (k - 0.15) * 3) * 0.3;
        d.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
        d.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      }
    }
  }

  /** 新开一局 / 回主菜单时清理瞬时 HUD 状态 */
  resetHud() {
    this.q.toasts.innerHTML = '';
    this.bannerQueue.length = 0;
    this.bannerEl?.remove(); this.bannerEl = null; this.bannerT = 0;
    this.q.dialog.classList.add('hidden'); this.dialogT = 0;
    this.setBoss(null);
    this.setPrompt(null);
    for (const d of this.dmg) { d.t = d.life; d.el.classList.add('hidden'); }
    this.cache = {};
  }
  dispose() {
    this.abort.abort();
    this.root.innerHTML = '';
  }
}
