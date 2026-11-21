/** 存档与设置（localStorage） */
const SAVE_KEY = 'skyward-isles.save.v1';
const SETTINGS_KEY = 'skyward-isles.settings.v1';

export type AbilityId = 'doubleJump' | 'windBlade' | 'glide';

export interface SaveData {
  version: 1;
  checkpoint: string;
  abilities: Record<AbilityId, boolean>;
  maxHp: number;
  maxStamina: number;
  potionsMax: number;
  shards: number;
  /** 已拾取 / 已开启的唯一物件 id */
  collected: string[];
  /** 已激活检查点、已解开谜题等标记 */
  flags: string[];
  playTime: number;
  deaths: number;
  kills: number;
  bossDefeated: boolean;
}

export function newSave(): SaveData {
  return {
    version: 1,
    checkpoint: 'cp_start',
    abilities: { doubleJump: false, windBlade: false, glide: false },
    maxHp: 100,
    maxStamina: 100,
    potionsMax: 3,
    shards: 0,
    collected: [],
    flags: [],
    playTime: 0,
    deaths: 0,
    kills: 0,
    bossDefeated: false,
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1 || typeof d.checkpoint !== 'string') return null;
    return { ...newSave(), ...d, abilities: { ...newSave().abilities, ...d.abilities } };
  } catch {
    return null;
  }
}
export function writeSave(d: SaveData) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* 隐私模式等情况下忽略 */ }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export type Quality = 'low' | 'medium' | 'high';
export interface Settings {
  quality: Quality;
  shadows: boolean;
  postfx: boolean;
  sensitivity: number;
  invertY: boolean;
  shake: number;
  master: number;
  music: number;
  sfx: number;
  showFps: boolean;
  fov: number;
}
export const defaultSettings = (): Settings => ({
  quality: 'high',
  shadows: true,
  postfx: true,
  sensitivity: 1,
  invertY: false,
  shake: 1,
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  showFps: false,
  fov: 58,
});
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* ignore */ }
  return defaultSettings();
}
export function writeSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
