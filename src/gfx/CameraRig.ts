/** 第三人称跟随相机：鼠标环绕、碰撞回缩、平滑跟随、创伤式镜头震动、冲刺 FOV */
import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { Input } from '../core/Input';
import { Physics, Q_WORLD } from '../core/Physics';
import type { Settings } from '../core/Save';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.32;
  dist = 6.8;
  private curDist = 6.8;
  target = new THREE.Vector3();
  private trauma = 0;
  private t = 0;
  private fovKick = 0;
  /** 过场镜头（菜单环绕 / 通关）时由外部接管 */
  cinematic = false;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.15, 1400);
  }

  get forwardX() { return -Math.sin(this.yaw); }
  get forwardZ() { return -Math.cos(this.yaw); }

  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }

  snapTo(pos: THREE.Vector3, yaw?: number) {
    this.target.set(pos.x, pos.y + 1.45, pos.z);
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0.32;
    this.curDist = this.dist;
  }

  update(dt: number, focus: THREE.Vector3, input: Input | null, settings: Settings, physics: Physics, sprintK: number) {
    this.t += dt;
    if (input) {
      const sens = 0.0023 * settings.sensitivity;
      this.yaw -= input.mouseDX * sens + input.lookX * 2.2 * dt;
      const inv = settings.invertY ? -1 : 1;
      this.pitch += (input.mouseDY * sens + input.lookY * 1.6 * dt) * inv;
      this.pitch = clamp(this.pitch, -0.95, 1.3);
      this.dist = clamp(this.dist + input.wheel * 0.7, 3.2, 11);
    }
    // 目标点平滑跟随（竖直方向略慢，跳跃时镜头更稳）
    const ty = focus.y + 1.45;
    this.target.x = damp(this.target.x, focus.x, 18, dt);
    this.target.z = damp(this.target.z, focus.z, 18, dt);
    this.target.y = damp(this.target.y, ty, Math.abs(ty - this.target.y) > 3 ? 14 : 8, dt);

    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // 碰撞：从目标点向相机方向射线，避免穿墙 / 穿地
    let want = this.dist;
    const hit = physics.raycast(this.target.x, this.target.y, this.target.z, this.dir.x, this.dir.y, this.dir.z, this.dist + 0.4, Q_WORLD);
    if (hit) want = Math.max(0.9, hit.dist - 0.4);
    this.curDist = want < this.curDist ? damp(this.curDist, want, 30, dt) : damp(this.curDist, want, 4, dt);

    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, this.curDist);
    cam.lookAt(this.target);

    // 震动
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const s = this.trauma * this.trauma * settings.shake;
    if (s > 0.0001) {
      const t = this.t * 38;
      cam.position.x += Math.sin(t * 1.13) * 0.28 * s;
      cam.position.y += Math.sin(t * 1.71 + 2) * 0.28 * s;
      cam.rotation.z += Math.sin(t * 0.93 + 1) * 0.045 * s;
      cam.rotation.x += Math.sin(t * 1.37 + 4) * 0.03 * s;
    }
    this.fovKick = damp(this.fovKick, sprintK, 5, dt);
    const fov = settings.fov + this.fovKick * 7;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  /** 菜单 / 过场用：绕某点缓慢环绕 */
  orbit(center: THREE.Vector3, radius: number, height: number, angle: number, lookY = 2) {
    this.camera.position.set(center.x + Math.sin(angle) * radius, center.y + height, center.z + Math.cos(angle) * radius);
    this.tmp.set(center.x, center.y + lookY, center.z);
    this.camera.lookAt(this.tmp);
  }
}
