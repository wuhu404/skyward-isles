import type * as THREE from 'three';
import type { Physics } from './Physics';
import type { Input } from './Input';
import type { AudioSys } from './Audio';
import type { SaveData, Settings, AbilityId } from './Save';
import type { Particles } from '../gfx/Particles';
import type { Effects } from '../gfx/Effects';
import type { CameraRig } from '../gfx/CameraRig';
import type { Materials } from '../gfx/geo';
import type { Player } from '../entities/Player';
import type { World } from '../world/World';
import type { Projectiles } from '../entities/Projectiles';

export interface HitInfo {
  damage: number;
  /** 击退方向（水平单位向量） */
  dirX: number;
  dirZ: number;
  knock: number;
  heavy: boolean;
  source: 'sword' | 'blade';
}
/** 可被玩家剑 / 风刃命中的对象 */
export interface Hittable {
  readonly hitPos: THREE.Vector3;
  readonly hitRadius: number;
  readonly hitHeight: number;
  /** 是否参与自动瞄准（敌人、机关） */
  readonly aimable: boolean;
  canBeHit(): boolean;
  /** 返回 true 表示确实命中（用于顿帧 / 音效） */
  onHit(h: HitInfo): boolean;
}

export interface UIHooks {
  toast(text: string, kind?: 'info' | 'good' | 'item', seconds?: number): void;
  banner(title: string, sub?: string): void;
  damageNumber(pos: THREE.Vector3, amount: number, kind: 'enemy' | 'player' | 'heal' | 'crit'): void;
  setPrompt(text: string | null): void;
  setObjective(text: string): void;
  setBoss(name: string | null, frac?: number, phase?: number): void;
  abilityCard(title: string, desc: string, key: string): void;
  dialog(text: string, seconds?: number): void;
}

/** 游戏上下文：所有系统通过它互相访问，避免到处 import 单例 */
export interface Ctx {
  scene: THREE.Scene;
  physics: Physics;
  input: Input;
  audio: AudioSys;
  particles: Particles;
  fx: Effects;
  cam: CameraRig;
  mats: Materials;
  settings: Settings;
  save: SaveData;
  player: Player;
  world: World;
  projectiles: Projectiles;
  ui: UIHooks;
  /** 游戏内时间（秒） */
  time: number;
  hitStop(seconds: number): void;
  saveGame(): void;
  hasFlag(f: string): boolean;
  setFlag(f: string): void;
  isCollected(id: string): boolean;
  collect(id: string): void;
  unlockAbility(a: AbilityId): void;
  setCheckpoint(id: string): void;
  onPlayerDeath(): void;
  onBossDefeated(): void;
  flash(amount: number): void;
}
