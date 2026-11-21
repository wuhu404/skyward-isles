/**
 * 程序化主角：由合并几何体搭出的关节层级 + 基于“目标姿态阻尼”的程序化动画。
 * 每个动画只负责写出目标关节角，关节再以指数阻尼追随，天然获得平滑过渡。
 */
import * as THREE from 'three';
import { MeshBuilder } from '../gfx/geo';
import { damp, easeInOut, easeOutCubic, lerp, clamp01 } from '../core/math';

export type AnimMode = 'idle' | 'run' | 'jump' | 'fall' | 'glide' | 'attack1' | 'attack2' | 'attack3' | 'dodge' | 'hurt' | 'dead' | 'cast';
export interface AnimState { mode: AnimMode; t: number; speed: number; }

const J = { HIPS: 0, TORSO: 1, HEAD: 2, ARML: 3, FOREL: 4, ARMR: 5, FORER: 6, LEGL: 7, SHINL: 8, LEGR: 9, SHINR: 10, SWORD: 11, CAPE: 12, N: 13 } as const;

/** 分段线性关键帧（带平滑） */
function kf(u: number, ...pts: number[]): number {
  if (u <= pts[0]) return pts[1];
  for (let i = 2; i < pts.length; i += 2) {
    if (u <= pts[i]) {
      const t = (u - pts[i - 2]) / (pts[i] - pts[i - 2]);
      return lerp(pts[i - 1], pts[i + 1], t * t * (3 - 2 * t));
    }
  }
  return pts[pts.length - 1];
}

export class Humanoid {
  root = new THREE.Group();
  private pivot = new THREE.Group();
  private body = new THREE.Group();
  private joints: THREE.Object3D[] = [];
  private tgt = new Float32Array(J.N * 3);
  private cur = new Float32Array(J.N * 3);
  private phase = 0;
  private time = 0;
  private hipsY = 0;
  private roll = 0;
  private spin = 0;
  mat: THREE.MeshStandardMaterial;
  bladeMat: THREE.MeshStandardMaterial;
  private glider: THREE.Mesh;
  private gliderMat: THREE.MeshBasicMaterial;
  private swordBase = new THREE.Object3D();
  private swordTip = new THREE.Object3D();
  basePos = new THREE.Vector3();
  tipPos = new THREE.Vector3();
  private geos: THREE.BufferGeometry[] = [];
  /** 落地挤压 */
  squash = 0;

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0 });
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, emissive: 0x7fe8ff, emissiveIntensity: 1.1, flatShading: true, roughness: 0.25, metalness: 0.4 });
    const SKIN = 0xf4c9a2, HAIR = 0x34294e, TUNIC = 0x2a9aa6, TRIM = 0xf4f0e2, SCARF = 0xf0603a, PANTS = 0x3a3f66, BOOT = 0x6a4630, GOLD = 0xf0c050;

    const part = (build: (b: MeshBuilder) => void, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const b = new MeshBuilder(0.035, this.joints.length + 3);
      build(b);
      if (b.triangleCount > 0) {
        const geo = b.build();
        this.geos.push(geo);
        const m = new THREE.Mesh(geo, this.mat);
        m.castShadow = true;
        g.add(m);
      }
      parent.add(g);
      this.joints.push(g);
      return g;
    };

    this.root.add(this.pivot);
    this.pivot.position.y = 0.82;
    this.pivot.add(this.body);

    const hips = part((b) => {
      b.box(0.42, 0.2, 0.28, PANTS, 0, 0, 0);
      b.box(0.46, 0.08, 0.3, 0x7a4a2a, 0, 0.1, 0); // 腰带
      b.box(0.1, 0.1, 0.04, GOLD, 0, 0.1, 0.16);
    }, this.body, 0, 0, 0);
    const torso = part((b) => {
      b.add(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 6), TUNIC, new THREE.Matrix4().makeTranslation(0, 0.32, 0).scale(new THREE.Vector3(1.1, 1, 0.75)), 0x48c2c8);
      b.box(0.5, 0.1, 0.33, TRIM, 0, 0.1, 0); // 下摆
      b.box(0.1, 0.36, 0.02, TRIM, 0, 0.34, 0.165); // 胸前饰带
      // 围巾
      b.add(new THREE.CylinderGeometry(0.2, 0.23, 0.13, 7), SCARF, new THREE.Matrix4().makeTranslation(0, 0.6, 0));
    }, hips, 0, 0.1, 0);
    part((b) => {
      b.ico(0.25, 1, SKIN, 0, 0.22, 0, 1, 1.02, 0.96);
      // 头发：后脑 + 刘海 + 发辫
      b.ico(0.27, 1, HAIR, 0, 0.29, -0.05, 1.02, 0.92, 1);
      b.box(0.44, 0.1, 0.1, HAIR, 0, 0.4, 0.2, 0.25, 0, 0);
      b.cone(0.09, 0.3, 4, HAIR, 0.14, 0.5, -0.06, -0.5, 0, -0.4);
      b.cone(0.07, 0.24, 4, HAIR, -0.1, 0.52, -0.02, -0.3, 0, 0.5);
      b.box(0.06, 0.08, 0.02, 0x1c1a2e, 0.1, 0.22, 0.238); // 眼
      b.box(0.06, 0.08, 0.02, 0x1c1a2e, -0.1, 0.22, 0.238);
      b.box(0.05, 0.03, 0.02, 0xe89a8a, 0.17, 0.13, 0.215); // 腮红
      b.box(0.05, 0.03, 0.02, 0xe89a8a, -0.17, 0.13, 0.215);
    }, torso, 0, 0.64, 0);
    const arm = (side: number) => {
      const up = part((b) => {
        b.box(0.14, 0.3, 0.14, TUNIC, 0, -0.13, 0);
        b.ico(0.1, 0, TRIM, 0, 0, 0);
      }, torso, side * 0.33, 0.5, 0);
      const fore = part((b) => {
        b.box(0.11, 0.26, 0.11, SKIN, 0, -0.12, 0);
        b.box(0.14, 0.1, 0.14, 0x7a4a2a, 0, -0.06, 0); // 护腕
        b.box(0.13, 0.12, 0.13, SKIN, 0, -0.3, 0); // 手
      }, up, 0, -0.29, 0);
      return fore;
    };
    arm(1);
    const foreR = arm(-1);
    const leg = (side: number) => {
      const th = part((b) => b.box(0.17, 0.38, 0.19, PANTS, 0, -0.17, 0), hips, side * 0.12, -0.06, 0);
      part((b) => {
        b.box(0.15, 0.3, 0.16, PANTS, 0, -0.13, 0);
        b.box(0.19, 0.2, 0.3, BOOT, 0, -0.3, 0.04);
        b.box(0.2, 0.06, 0.2, TRIM, 0, -0.2, 0);
      }, th, 0, -0.36, 0);
    };
    leg(1);
    leg(-1);
    // 剑（握在右手，剑身沿 +Z）
    const sword = part((b) => {
      b.box(0.05, 0.05, 0.22, 0x5a3a2a, 0, 0, -0.02);
      b.box(0.3, 0.06, 0.07, GOLD, 0, 0, 0.1);
      b.ico(0.05, 0, GOLD, 0, 0, -0.15);
    }, foreR, 0, -0.31, 0.02);
    const bladeGeo = new THREE.BufferGeometry();
    {
      const bb = new MeshBuilder(0, 1);
      bb.box(0.1, 0.035, 0.85, 0xffffff, 0, 0, 0.56);
      bb.cone(0.058, 0.2, 4, 0xffffff, 0, 0, 1.08, Math.PI / 2, 0, 0);
      bladeGeo.copy(bb.build());
    }
    this.geos.push(bladeGeo);
    const blade = new THREE.Mesh(bladeGeo, this.bladeMat);
    blade.castShadow = true;
    sword.add(blade);
    this.swordBase.position.set(0, 0, 0.2);
    this.swordTip.position.set(0, 0, 1.2);
    sword.add(this.swordBase, this.swordTip);
    // 披风
    part((b) => {
      b.add(new THREE.PlaneGeometry(0.52, 0.72, 2, 3), SCARF, new THREE.Matrix4().makeTranslation(0, -0.36, 0), 0xc23a2a);
    }, torso, 0, 0.56, -0.19);
    (this.joints[J.CAPE].children[0] as THREE.Mesh).material = this.mat;

    // 滑翔翼（风之翼）
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.5, 1.7, 0.1, -0.5, 0, 0.05, -0.25,
      0, 0, 0.5, 0, 0.05, -0.25, -1.7, 0.1, -0.5,
    ], 3));
    gl.computeVertexNormals();
    this.geos.push(gl);
    this.gliderMat = new THREE.MeshBasicMaterial({ color: 0x8ff5ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glider = new THREE.Mesh(gl, this.gliderMat);
    this.glider.position.set(0, 0.95, -0.1);
    this.glider.visible = false;
    torso.add(this.glider);

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.glider) o.castShadow = true; });
  }

  private set(j: number, x: number, y = 0, z = 0) {
    const i = j * 3;
    this.tgt[i] = x; this.tgt[i + 1] = y; this.tgt[i + 2] = z;
  }

  update(dt: number, s: AnimState) {
    this.time += dt;
    const T = this.time;
    this.tgt.fill(0);
    let rate = 14;
    let hipsY = 0;
    let roll = 0;
    let spin = 0;
    let gliding = false;
    // 默认：手臂微张、持剑
    this.set(J.ARML, 0.05, 0, 0.14);
    this.set(J.ARMR, -0.15, 0, -0.16);
    this.set(J.FOREL, -0.15);
    this.set(J.FORER, -0.35);
    this.set(J.SWORD, 0.35, 0, 0);
    this.set(J.CAPE, 0.12 + Math.sin(T * 2.2) * 0.05);

    switch (s.mode) {
      case 'idle': {
        const b = Math.sin(T * 2.1);
        hipsY = b * 0.012;
        this.set(J.TORSO, 0.02 + b * 0.02, 0, 0);
        this.set(J.HEAD, -b * 0.02, Math.sin(T * 0.6) * 0.12, 0);
        this.set(J.ARML, 0.05, 0, 0.14 + b * 0.02);
        break;
      }
      case 'run': {
        const k = clamp01(s.speed);
        const sprint = s.speed > 1.15 ? 1 : 0;
        this.phase += dt * (7.5 + 5.5 * s.speed);
        const ph = this.phase;
        const sw = Math.sin(ph);
        const A = (0.75 + sprint * 0.3) * k;
        hipsY = Math.abs(Math.cos(ph)) * 0.07 * k - 0.03 * k;
        this.set(J.HIPS, 0, sw * 0.12 * k, 0);
        this.set(J.TORSO, (0.16 + sprint * 0.22) * k, -sw * 0.2 * k, 0);
        this.set(J.HEAD, -0.08 * k, 0, 0);
        this.set(J.LEGL, sw * A, 0, 0);
        this.set(J.LEGR, -sw * A, 0, 0);
        this.set(J.SHINL, Math.max(0, -Math.cos(ph)) * 1.3 * k + 0.1 * k);
        this.set(J.SHINR, Math.max(0, Math.cos(ph)) * 1.3 * k + 0.1 * k);
        this.set(J.ARML, -sw * A * 0.9, 0, 0.16);
        this.set(J.FOREL, -0.8 * k);
        this.set(J.ARMR, sw * A * 0.5 - 0.1 + sprint * 0.5, 0, -0.22 - sprint * 0.3);
        this.set(J.FORER, -0.6 * k);
        this.set(J.SWORD, 0.5 + sprint * 0.7, 0, 0);
        this.set(J.CAPE, 0.35 + 0.5 * k + Math.sin(ph * 2) * 0.12);
        break;
      }
      case 'jump':
        this.set(J.TORSO, -0.08);
        this.set(J.LEGL, -0.9); this.set(J.SHINL, 1.3);
        this.set(J.LEGR, 0.25); this.set(J.SHINR, 0.5);
        this.set(J.ARML, -0.4, 0, 0.9); this.set(J.ARMR, -0.3, 0, -0.8);
        this.set(J.CAPE, 0.2);
        break;
      case 'fall': {
        const w = Math.sin(T * 14) * 0.08;
        this.set(J.TORSO, 0.1);
        this.set(J.LEGL, -0.35 + w); this.set(J.SHINL, 0.6);
        this.set(J.LEGR, 0.2 - w); this.set(J.SHINR, 0.4);
        this.set(J.ARML, 0.1, 0, 1.5 + w); this.set(J.ARMR, 0.1, 0, -1.4 - w);
        this.set(J.CAPE, 1.6 + w);
        break;
      }
      case 'glide': {
        gliding = true;
        const w = Math.sin(T * 3) * 0.05;
        this.set(J.TORSO, 0.75);
        this.set(J.HEAD, -0.6);
        this.set(J.LEGL, 0.5 + w); this.set(J.SHINL, 0.25);
        this.set(J.LEGR, 0.6 - w); this.set(J.SHINR, 0.15);
        this.set(J.ARML, -0.2, 0, 1.45); this.set(J.ARMR, -0.2, 0, -1.45);
        this.set(J.FOREL, 0); this.set(J.FORER, 0);
        this.set(J.SWORD, 1.4);
        this.set(J.CAPE, 1.0 + w * 3);
        break;
      }
      case 'attack1': {
        rate = 30;
        const u = s.t;
        hipsY = -0.07;
        this.set(J.HIPS, 0, kf(u, 0, 0, 0.22, -0.3, 0.5, 0.35, 1, 0.1), 0);
        this.set(J.TORSO, 0.15, kf(u, 0, 0, 0.22, -0.75, 0.5, 0.85, 1, 0.3), 0);
        this.set(J.ARMR, kf(u, 0, -0.3, 0.22, 0.2, 0.5, -1.5, 1, -0.7), 0, kf(u, 0, -0.3, 0.22, -1.5, 0.5, -0.35, 1, -0.3));
        this.set(J.FORER, kf(u, 0, -0.4, 0.22, -0.7, 0.45, -0.1, 1, -0.3));
        this.set(J.SWORD, kf(u, 0, 0.5, 0.22, 1.2, 0.5, 1.55, 1, 0.8), 0, 0);
        this.set(J.ARML, 0.4, 0, 0.5); this.set(J.FOREL, -0.6);
        this.set(J.LEGL, -0.55); this.set(J.SHINL, 0.45); this.set(J.LEGR, 0.45); this.set(J.SHINR, 0.2);
        this.set(J.CAPE, 0.7);
        break;
      }
      case 'attack2': {
        rate = 30;
        const u = s.t;
        hipsY = -0.07;
        this.set(J.HIPS, 0, kf(u, 0, 0.2, 0.22, 0.35, 0.5, -0.3, 1, 0), 0);
        this.set(J.TORSO, 0.15, kf(u, 0, 0.5, 0.22, 0.95, 0.5, -0.85, 1, -0.2), 0);
        this.set(J.ARMR, kf(u, 0, -1.2, 0.22, -1.5, 0.5, -1.25, 1, -0.5), 0, kf(u, 0, 0.2, 0.22, 0.75, 0.5, -1.35, 1, -0.5));
        this.set(J.FORER, kf(u, 0, -0.3, 0.22, -0.9, 0.5, -0.05, 1, -0.3));
        this.set(J.SWORD, kf(u, 0, 1.2, 0.5, 1.55, 1, 0.8), 0, 0);
        this.set(J.ARML, 0.3, 0, 0.7); this.set(J.FOREL, -0.4);
        this.set(J.LEGR, -0.55); this.set(J.SHINR, 0.45); this.set(J.LEGL, 0.45); this.set(J.SHINL, 0.2);
        this.set(J.CAPE, 0.7);
        break;
      }
      case 'attack3': {
        rate = 30;
        const u = s.t;
        spin = easeInOut(clamp01((u - 0.05) / 0.5)) * Math.PI * 2;
        hipsY = kf(u, 0, 0, 0.3, 0.28, 0.6, -0.16, 1, 0);
        this.set(J.TORSO, kf(u, 0, -0.2, 0.3, -0.35, 0.6, 0.55, 1, 0.2), 0, 0);
        this.set(J.ARMR, kf(u, 0, -1.0, 0.3, -2.9, 0.58, -0.75, 1, -0.5), 0, -0.15);
        this.set(J.ARML, kf(u, 0, -1.0, 0.3, -2.7, 0.58, -0.75, 1, -0.2), 0, 0.15);
        this.set(J.FORER, -0.15); this.set(J.FOREL, -0.4);
        this.set(J.SWORD, kf(u, 0, 0.9, 0.3, 1.0, 0.58, 1.6, 1, 0.9), 0, 0);
        this.set(J.LEGL, kf(u, 0, -0.3, 0.3, -0.9, 0.6, -0.7, 1, -0.2)); this.set(J.SHINL, kf(u, 0, 0.4, 0.3, 1.2, 0.6, 0.7, 1, 0.2));
        this.set(J.LEGR, kf(u, 0, 0.2, 0.3, 0.3, 0.6, 0.6, 1, 0.2)); this.set(J.SHINR, kf(u, 0, 0.3, 0.3, 0.9, 0.6, 0.4, 1, 0.1));
        this.set(J.CAPE, 1.2);
        break;
      }
      case 'cast': {
        rate = 26;
        const u = s.t;
        this.set(J.TORSO, 0.1, kf(u, 0, 0.5, 0.35, -0.5, 1, 0), 0);
        this.set(J.ARMR, kf(u, 0, -0.6, 0.35, -1.55, 1, -0.6), 0, kf(u, 0, -1.2, 0.35, -0.1, 1, -0.3));
        this.set(J.FORER, -0.05);
        this.set(J.SWORD, 1.5);
        this.set(J.ARML, 0.5, 0, 0.6);
        this.set(J.LEGL, -0.45); this.set(J.SHINL, 0.4); this.set(J.LEGR, 0.4);
        break;
      }
      case 'dodge': {
        rate = 26;
        roll = easeOutCubic(s.t) * Math.PI * 2;
        hipsY = -0.3 * Math.sin(Math.PI * clamp01(s.t * 1.1));
        this.set(J.TORSO, 0.7); this.set(J.HEAD, 0.5);
        this.set(J.LEGL, -1.7); this.set(J.SHINL, 2.0); this.set(J.LEGR, -1.6); this.set(J.SHINR, 1.9);
        this.set(J.ARML, -1.1, 0, 0.3); this.set(J.FOREL, -1.4);
        this.set(J.ARMR, -0.9, 0, -0.5); this.set(J.FORER, -1.0);
        this.set(J.SWORD, 1.2);
        break;
      }
      case 'hurt':
        rate = 24;
        this.set(J.TORSO, -0.45, 0.2, 0); this.set(J.HEAD, -0.3);
        this.set(J.ARML, -0.3, 0, 1.0); this.set(J.ARMR, -0.2, 0, -1.1);
        this.set(J.LEGL, -0.3); this.set(J.LEGR, 0.3); this.set(J.SHINR, 0.4);
        break;
      case 'dead': {
        rate = 10;
        const u = easeOutCubic(clamp01(s.t));
        roll = -u * 1.5;
        hipsY = -0.62 * u;
        this.set(J.ARML, -0.4, 0, 1.3); this.set(J.ARMR, -0.2, 0, -1.3);
        this.set(J.LEGL, -0.2, 0, 0.2); this.set(J.LEGR, 0.1, 0, -0.2);
        this.set(J.HEAD, -0.3);
        break;
      }
    }

    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < J.N; i++) {
      const i3 = i * 3;
      this.cur[i3] += (this.tgt[i3] - this.cur[i3]) * k;
      this.cur[i3 + 1] += (this.tgt[i3 + 1] - this.cur[i3 + 1]) * k;
      this.cur[i3 + 2] += (this.tgt[i3 + 2] - this.cur[i3 + 2]) * k;
      this.joints[i].rotation.set(this.cur[i3], this.cur[i3 + 1], this.cur[i3 + 2]);
    }
    this.hipsY = damp(this.hipsY, hipsY, rate, dt);
    // 翻滚 / 回旋不做阻尼，直接跟随时间轴
    this.roll = s.mode === 'dodge' || s.mode === 'dead' ? roll : damp(this.roll > Math.PI ? this.roll - Math.PI * 2 : this.roll, 0, 20, dt);
    this.spin = s.mode === 'attack3' ? spin : 0;
    this.pivot.rotation.set(this.roll, this.spin, 0);
    this.squash = damp(this.squash, 0, 12, dt);
    const sq = this.squash;
    this.root.scale.set(1 + sq * 0.25, 1 - sq * 0.3, 1 + sq * 0.25);
    this.body.position.y = this.hipsY;

    // 滑翔翼展开 / 收起
    const gs = damp(this.glider.scale.x, gliding ? 1 : 0, 14, dt);
    this.glider.scale.setScalar(Math.max(0.001, gs));
    this.glider.visible = gs > 0.02;
    this.gliderMat.opacity = 0.5 + Math.sin(T * 6) * 0.08;

    this.root.updateWorldMatrix(true, true);
    this.swordBase.getWorldPosition(this.basePos);
    this.swordTip.getWorldPosition(this.tipPos);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
    this.bladeMat.dispose();
    this.gliderMat.dispose();
    this.root.removeFromParent();
  }
}
