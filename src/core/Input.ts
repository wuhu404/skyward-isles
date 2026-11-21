/**
 * 输入系统：键盘 / 鼠标 / 指针锁定。
 * 所有监听器通过 AbortController 统一注销，避免泄漏。
 */
export type Action =
  | 'jump' | 'sprint' | 'dodge' | 'attack' | 'skill' | 'interact' | 'potion' | 'pause';

const KEYMAP: Record<Action, string[]> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  dodge: ['KeyQ', 'Mouse2'],
  attack: ['Mouse0', 'KeyJ'],
  skill: ['KeyE'],
  interact: ['KeyF'],
  potion: ['KeyR'],
  pause: ['Escape', 'KeyP'],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private abort = new AbortController();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** 仅在“游玩中”才接收游戏按键 */
  enabled = false;
  onLockLost: (() => void) | null = null;
  onAnyKey: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const o = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => {
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.onAnyKey?.();
    }, o);
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    }, o);
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) this.requestLock();
      const k = 'Mouse' + e.button;
      this.down.add(k);
      this.pressed.add(k);
      e.preventDefault();
    }, o);
    window.addEventListener('mouseup', (e) => {
      const k = 'Mouse' + e.button;
      this.down.delete(k);
      this.released.add(k);
    }, o);
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      // 过滤指针锁定偶发的异常大跳变
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, o);
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { signal: this.abort.signal, passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) this.onLockLost?.();
    }, o);
    window.addEventListener('blur', () => this.clear(), o);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch { /* 某些环境不支持指针锁定，方向键仍可转动视角 */ }
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action) { return KEYMAP[a].some((k) => this.down.has(k)); }
  wasPressed(a: Action) { return KEYMAP[a].some((k) => this.pressed.has(k)); }
  wasReleased(a: Action) { return KEYMAP[a].some((k) => this.released.has(k)); }
  key(code: string) { return this.down.has(code); }
  keyPressed(code: string) { return this.pressed.has(code); }

  get moveX() { return (this.down.has('KeyD') ? 1 : 0) - (this.down.has('KeyA') ? 1 : 0); }
  get moveY() { return (this.down.has('KeyW') ? 1 : 0) - (this.down.has('KeyS') ? 1 : 0); }
  get lookX() { return (this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('ArrowLeft') ? 1 : 0); }
  get lookY() { return (this.down.has('ArrowDown') ? 1 : 0) - (this.down.has('ArrowUp') ? 1 : 0); }

  /** 每帧末尾调用，清空瞬时状态 */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
  clear() {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }
  dispose() {
    this.abort.abort();
    this.onLockLost = null;
    this.onAnyKey = null;
  }
}
