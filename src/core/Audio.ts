/**
 * 纯程序化音频：所有音效与环境音乐均由 WebAudio 实时合成，不依赖任何外部素材。
 */
import type { Settings } from './Save';

export type Sfx =
  | 'swing' | 'swingHeavy' | 'hit' | 'hitHeavy' | 'hurt' | 'jump' | 'doubleJump' | 'land' | 'dodge'
  | 'pickup' | 'relic' | 'chest' | 'heal' | 'shrine' | 'ability' | 'ui' | 'uiBack' | 'enemyDie'
  | 'blade' | 'orb' | 'slam' | 'roar' | 'thunder' | 'puzzle' | 'fail' | 'glide' | 'death' | 'victory' | 'plate' | 'break' | 'telegraph';

export type MusicMood = 'menu' | 'meadow' | 'ruins' | 'frost' | 'storm' | 'boss' | 'none';

const MOODS: Record<Exclude<MusicMood, 'none'>, { root: number; scale: number[]; tempo: number; cutoff: number; wave: OscillatorType; drive: boolean }> = {
  menu: { root: 57, scale: [0, 2, 4, 7, 9], tempo: 0.9, cutoff: 1400, wave: 'triangle', drive: false },
  meadow: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 1.0, cutoff: 1800, wave: 'triangle', drive: false },
  ruins: { root: 57, scale: [0, 2, 3, 7, 8], tempo: 0.8, cutoff: 1200, wave: 'triangle', drive: false },
  frost: { root: 59, scale: [0, 2, 5, 7, 10], tempo: 0.7, cutoff: 2200, wave: 'sine', drive: false },
  storm: { root: 50, scale: [0, 1, 5, 7, 8], tempo: 0.6, cutoff: 700, wave: 'sawtooth', drive: false },
  boss: { root: 50, scale: [0, 3, 5, 6, 7, 10], tempo: 2.4, cutoff: 1500, wave: 'sawtooth', drive: true },
};
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private mood: MusicMood = 'none';
  private nextNote = 0;
  private beat = 0;
  private pad: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private vols = { master: 0.8, music: 0.6, sfx: 0.9 };
  private lastPlayed = new Map<string, number>();

  /** 需由用户手势触发 */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }
  applySettings(s: Settings) {
    this.vols = { master: s.master, music: s.music, sfx: s.sfx };
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vols.master;
    this.sfxBus.gain.value = this.vols.sfx;
    this.musicBus.gain.value = this.vols.music * 0.55;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, bus?: GainNode) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private burst(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'bandpass', q = 1, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: Sfx, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.035) return; // 防止同帧叠加爆音
    this.lastPlayed.set(name, now);
    const v = vol;
    switch (name) {
      case 'swing': this.burst(0.16, 0.22 * v, 900, 3200, 'bandpass', 1.2); break;
      case 'swingHeavy': this.burst(0.28, 0.3 * v, 500, 2600, 'bandpass', 1); this.tone(180, 0.2, 'sine', 0.1 * v, 90); break;
      case 'hit': this.burst(0.09, 0.4 * v, 2400, 600, 'bandpass', 0.8); this.tone(220, 0.1, 'square', 0.12 * v, 90); break;
      case 'hitHeavy': this.burst(0.18, 0.5 * v, 1800, 200, 'lowpass', 0.8); this.tone(140, 0.22, 'square', 0.2 * v, 50); break;
      case 'hurt': this.tone(300, 0.25, 'sawtooth', 0.22 * v, 110); this.burst(0.15, 0.3 * v, 800, 200, 'lowpass'); break;
      case 'jump': this.tone(320, 0.14, 'sine', 0.14 * v, 560); break;
      case 'doubleJump': this.tone(520, 0.16, 'sine', 0.14 * v, 980); this.burst(0.2, 0.1 * v, 1500, 5000, 'highpass'); break;
      case 'land': this.burst(0.1, 0.22 * v, 300, 80, 'lowpass'); break;
      case 'dodge': this.burst(0.22, 0.2 * v, 600, 2200, 'bandpass', 0.7); break;
      case 'pickup': this.tone(880, 0.1, 'sine', 0.16 * v); this.tone(1320, 0.16, 'sine', 0.14 * v, undefined, 0.06); break;
      case 'relic': [0, 4, 7, 12, 16].forEach((s, i) => this.tone(mtof(72 + s), 0.5, 'triangle', 0.14 * v, undefined, i * 0.09)); break;
      case 'chest': this.burst(0.2, 0.2 * v, 300, 900, 'bandpass'); [0, 5, 9].forEach((s, i) => this.tone(mtof(67 + s), 0.4, 'triangle', 0.15 * v, undefined, 0.12 + i * 0.1)); break;
      case 'heal': [0, 7, 12].forEach((s, i) => this.tone(mtof(69 + s), 0.35, 'sine', 0.14 * v, undefined, i * 0.07)); break;
      case 'shrine': [0, 7, 12, 19].forEach((s, i) => this.tone(mtof(57 + s), 1.2, 'sine', 0.13 * v, undefined, i * 0.12)); break;
      case 'ability': [0, 4, 7, 11, 14, 19].forEach((s, i) => this.tone(mtof(60 + s), 1.4, 'triangle', 0.13 * v, undefined, i * 0.11)); this.burst(1.6, 0.12 * v, 400, 6000, 'bandpass', 0.5); break;
      case 'ui': this.tone(660, 0.07, 'sine', 0.1 * v, 880); break;
      case 'uiBack': this.tone(520, 0.08, 'sine', 0.1 * v, 360); break;
      case 'enemyDie': this.tone(260, 0.35, 'triangle', 0.18 * v, 60); this.burst(0.3, 0.25 * v, 1200, 150, 'lowpass'); break;
      case 'blade': this.burst(0.35, 0.28 * v, 1200, 5200, 'bandpass', 2); this.tone(700, 0.3, 'sine', 0.08 * v, 1500); break;
      case 'orb': this.tone(480, 0.25, 'sine', 0.13 * v, 240); break;
      case 'slam': this.tone(90, 0.5, 'sine', 0.5 * v, 30); this.burst(0.45, 0.5 * v, 700, 60, 'lowpass'); break;
      case 'roar': this.tone(110, 1.3, 'sawtooth', 0.3 * v, 55); this.tone(116, 1.3, 'sawtooth', 0.25 * v, 50); this.burst(1.2, 0.3 * v, 300, 900, 'bandpass', 0.6); break;
      case 'thunder': this.burst(0.9, 0.55 * v, 3000, 60, 'lowpass', 0.5); this.tone(70, 0.7, 'sine', 0.35 * v, 30); break;
      case 'puzzle': [0, 4, 7, 12].forEach((s, i) => this.tone(mtof(64 + s), 0.6, 'sine', 0.15 * v, undefined, i * 0.13)); break;
      case 'fail': this.tone(220, 0.25, 'square', 0.1 * v, 150); this.tone(160, 0.3, 'square', 0.1 * v, 100, 0.15); break;
      case 'glide': this.burst(0.5, 0.14 * v, 400, 1800, 'bandpass', 0.6); break;
      case 'death': [0, -3, -7, -12].forEach((s, i) => this.tone(mtof(57 + s), 0.9, 'triangle', 0.16 * v, undefined, i * 0.22)); break;
      case 'victory': [0, 4, 7, 12, 7, 12, 16, 24].forEach((s, i) => this.tone(mtof(60 + s), 0.9, 'triangle', 0.15 * v, undefined, i * 0.16)); break;
      case 'plate': this.tone(180, 0.18, 'square', 0.12 * v, 120); this.burst(0.12, 0.15 * v, 400, 150, 'lowpass'); break;
      case 'break': this.burst(0.22, 0.35 * v, 2600, 500, 'bandpass', 0.6); break;
      case 'telegraph': this.tone(900, 0.18, 'sine', 0.07 * v, 1300); break;
    }
  }

  setMood(m: MusicMood) {
    if (m === this.mood) return;
    this.mood = m;
    if (!this.ctx) return;
    this.stopPad();
    this.nextNote = this.ctx.currentTime + 0.3;
    this.beat = 0;
  }
  private stopPad() {
    if (!this.pad || !this.ctx) return;
    const t = this.ctx.currentTime;
    const p = this.pad;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0, t + 1.5);
    p.osc.forEach((o) => o.stop(t + 1.6));
    this.pad = null;
  }
  private startPad(notes: number[], cutoff: number, wave: OscillatorType) {
    const c = this.ctx!;
    this.stopPad();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff * 0.5;
    filter.Q.value = 0.6;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.11, c.currentTime + 2.5);
    filter.connect(gain).connect(this.musicBus);
    const osc: OscillatorNode[] = [];
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = wave === 'sine' ? 'triangle' : wave;
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(filter);
        o.start();
        osc.push(o);
      }
    }
    this.pad = { osc, gain, filter };
  }

  /** 每帧调用：按节拍调度音符（简单的生成式配乐） */
  update() {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.mood === 'none') return;
    const m = MOODS[this.mood];
    const step = 0.5 / m.tempo;
    while (this.nextNote < c.currentTime + 0.25) {
      const t = this.nextNote - c.currentTime;
      const b = this.beat++;
      // 每 16 拍换一次和弦垫音
      if (b % 16 === 0) {
        const prog = [0, 3, 1, 4][(b / 16) % 4 | 0];
        const deg = (i: number) => m.root - 12 + m.scale[(prog + i) % m.scale.length] + 12 * Math.floor((prog + i) / m.scale.length);
        this.startPad([deg(0), deg(2), deg(4)], m.cutoff, m.wave);
      }
      if (m.drive) {
        // Boss 战：低音脉冲 + 军鼓噪声
        this.tone(mtof(m.root - 12 + (b % 8 === 6 ? 3 : 0)), step * 0.9, 'sawtooth', 0.12, undefined, t, this.musicBus);
        if (b % 4 === 2) this.musicBurst(0.12, 0.2, 1800, t);
        if (b % 4 === 0) this.tone(70, 0.2, 'sine', 0.3, 35, t, this.musicBus);
        if (b % 2 === 1 && Math.random() < 0.6) {
          const n = m.root + 12 + m.scale[Math.floor(Math.random() * m.scale.length)];
          this.tone(mtof(n), step * 1.6, 'square', 0.035, undefined, t, this.musicBus);
        }
      } else if (Math.random() < 0.55) {
        const oct = Math.random() < 0.3 ? 24 : 12;
        const n = m.root + oct + m.scale[Math.floor(Math.random() * m.scale.length)];
        this.tone(mtof(n), 1.6 / m.tempo, m.wave === 'sawtooth' ? 'triangle' : m.wave, 0.05, undefined, t, this.musicBus);
        if (Math.random() < 0.25) this.tone(mtof(n + 7), 1.2 / m.tempo, 'sine', 0.025, undefined, t + step * 0.5, this.musicBus);
      }
      this.nextNote += step;
    }
  }
  private musicBurst(dur: number, vol: number, freq: number, delay: number) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }
  suspend() { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  resume() { if (this.ctx?.state === 'suspended') void this.ctx.resume(); }
  dispose() {
    this.stopPad();
    void this.ctx?.close();
    this.ctx = null;
  }
}
