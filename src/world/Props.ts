/**
 * 程序化场景道具：全部写入共享的 MeshBuilder（每个岛一次 draw call），并按需登记静态碰撞体。
 */
import * as THREE from 'three';
import { MeshBuilder, trs } from '../gfx/geo';
import type { Physics } from '../core/Physics';
import { TAU } from '../core/math';

export interface PropCtx {
  b: MeshBuilder;
  /** 自发光部件（MeshBasic + 顶点色，配合 Bloom） */
  glow: MeshBuilder;
  physics: Physics;
  rng: () => number;
}

export type TreeKind = 'round' | 'pine' | 'autumn' | 'dead' | 'frost';

export function tree(c: PropCtx, x: number, y: number, z: number, s = 1, kind: TreeKind = 'round') {
  const { b, rng } = c;
  const ry = rng() * TAU;
  const lean = (rng() - 0.5) * 0.12;
  if (kind === 'pine' || kind === 'frost') {
    const trunk = kind === 'frost' ? 0x5a4a5a : 0x6b4a32;
    const l1 = kind === 'frost' ? 0x5f9fb0 : 0x2f7d4f, l2 = kind === 'frost' ? 0xe8f6ff : 0x57a85a;
    b.cyl(0.16 * s, 0.26 * s, 1.6 * s, 5, trunk, x, y + 0.7 * s, z, lean, ry, 0);
    for (let i = 0; i < 4; i++) {
      const k = 1 - i * 0.2;
      b.cone(1.5 * s * k, 1.7 * s * k + 0.3, 6, l1, x + lean * i * 0.4, y + (1.6 + i * 1.05) * s, z, 0, ry + i * 0.6, 0, l2);
    }
  } else if (kind === 'dead') {
    b.cyl(0.14 * s, 0.3 * s, 3.2 * s, 5, 0x4a3b3a, x, y + 1.5 * s, z, lean, ry, 0, 0x6a5650);
    for (let i = 0; i < 4; i++) {
      const a = ry + i * 1.7, h = (1.6 + i * 0.45) * s;
      b.cyl(0.04 * s, 0.1 * s, 1.5 * s, 4, 0x5a4844, x + Math.sin(a) * 0.5 * s, y + h + 0.4 * s, z + Math.cos(a) * 0.5 * s, 0.9, a, 0);
    }
  } else {
    const l1 = kind === 'autumn' ? 0xd8742c : 0x3f9a45, l2 = kind === 'autumn' ? 0xf6c04a : 0x8bd45c;
    b.cyl(0.2 * s, 0.34 * s, 2.4 * s, 6, 0x7a5236, x, y + 1.1 * s, z, lean, ry, 0, 0x8f6a48);
    b.rock(1.55 * s, rng() * 99, l1, x, y + 3.3 * s, z, 1, 0.82, 1, ry, l2);
    b.rock(1.05 * s, rng() * 99, l1, x + Math.sin(ry) * 1.1 * s, y + 2.7 * s, z + Math.cos(ry) * 1.1 * s, 1, 0.8, 1, ry, l2);
    b.rock(0.95 * s, rng() * 99, l1, x - Math.sin(ry + 0.8) * 1.0 * s, y + 3.0 * s, z - Math.cos(ry + 0.8) * 1.0 * s, 1, 0.8, 1, ry, l2);
  }
  c.physics.staticCylinder(x, y + 1.5 * s, z, 1.5 * s, 0.32 * s);
}

export function rock(c: PropCtx, x: number, y: number, z: number, s = 1, color = 0x8d8f98, color2 = 0xb8bac2, collide = true) {
  const sy = 0.6 + c.rng() * 0.5;
  c.b.rock(s, c.rng() * 99, color, x, y + s * sy * 0.35, z, 1, sy, 0.8 + c.rng() * 0.4, c.rng() * TAU, color2);
  if (collide && s > 0.6) c.physics.staticCylinder(x, y + s * sy * 0.4, z, s * sy * 0.6, s * 0.72);
}

export function bush(c: PropCtx, x: number, y: number, z: number, s = 1, color = 0x3f9a45, color2 = 0x8bd45c) {
  c.b.rock(0.6 * s, c.rng() * 99, color, x, y + 0.3 * s, z, 1.2, 0.75, 1.1, c.rng() * TAU, color2);
  c.b.rock(0.42 * s, c.rng() * 99, color, x + 0.5 * s, y + 0.22 * s, z + 0.2 * s, 1, 0.8, 1, 0, color2);
}

export function flowers(c: PropCtx, x: number, y: number, z: number, color: number, n = 5) {
  for (let i = 0; i < n; i++) {
    const a = c.rng() * TAU, d = c.rng() * 0.9;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d, h = 0.22 + c.rng() * 0.2;
    c.b.box(0.03, h, 0.03, 0x4a9a40, fx, y + h / 2, fz);
    c.b.add(new THREE.OctahedronGeometry(0.09), color, trs(fx, y + h + 0.04, fz, 0, a, 0), undefined, 0.12);
  }
}

/** 遗迹石柱；broken 时为断柱。返回柱顶高度 */
export function pillar(c: PropCtx, x: number, y: number, z: number, h = 5, r = 0.55, color = 0xd9c8a4, broken = false) {
  const { b, rng } = c;
  const shade = 0xa89878;
  b.box(r * 2.8, 0.45, r * 2.8, color, x, y + 0.22, z, 0, 0, 0, shade);
  const hh = broken ? h * (0.35 + rng() * 0.3) : h;
  b.cyl(r * 0.88, r, hh, 7, color, x, y + 0.45 + hh / 2, z, 0, rng(), 0, shade);
  if (!broken) {
    b.box(r * 2.5, 0.4, r * 2.5, color, x, y + 0.45 + hh + 0.2, z, 0, 0, 0, shade);
  } else {
    b.cyl(r * 0.5, r * 0.88, 0.5, 5, color, x + 0.1, y + 0.45 + hh + 0.2, z, 0.15, rng(), 0.1);
    const a = rng() * TAU;
    b.cyl(r * 0.88, r * 0.88, 1.4, 7, color, x + Math.cos(a) * 1.8, y + r * 0.8, z + Math.sin(a) * 1.8, Math.PI / 2, a, 0, shade);
  }
  c.physics.staticCylinder(x, y + (hh + 0.9) / 2, z, (hh + 0.9) / 2, r * 1.15);
  return y + hh + 0.85;
}

/** 石拱门（沿 rotY 方向横跨 width） */
export function arch(c: PropCtx, x: number, y: number, z: number, width = 5, h = 6, rotY = 0, color = 0xd9c8a4) {
  const { b } = c;
  const cx = Math.cos(rotY), sx = -Math.sin(rotY);
  for (const s of [-1, 1]) {
    const px = x + cx * s * width / 2, pz = z + sx * s * width / 2;
    b.box(1.2, h, 1.2, color, px, y + h / 2, pz, 0, rotY, 0, 0xa89878);
    b.box(1.5, 0.4, 1.5, color, px, y + 0.2, pz, 0, rotY, 0);
    c.physics.staticBox(px, y + h / 2, pz, 0.6, h / 2, 0.6, rotY);
  }
  b.box(width + 2.2, 1.0, 1.4, color, x, y + h + 0.5, z, 0, rotY, 0, 0xa89878);
  b.box(width * 0.5, 0.5, 1.5, color, x, y + h + 1.25, z, 0, rotY, 0);
  c.physics.staticBox(x, y + h + 0.5, z, width / 2 + 1.1, 0.5, 0.7, rotY);
}

/** 带碰撞的石块 / 平台 */
export function block(c: PropCtx, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, color = 0xcbbd9c, color2 = 0x9c8c70) {
  c.b.box(w, h, d, color, x, y + h / 2, z, 0, rotY, 0, color2);
  c.physics.staticBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rotY);
}

/** 残墙 */
export function wall(c: PropCtx, x: number, y: number, z: number, len: number, h: number, rotY = 0, color = 0xcbbd9c) {
  const { b, rng } = c;
  const n = Math.max(2, Math.round(len / 1.6));
  const cx = Math.cos(rotY), sx = -Math.sin(rotY);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const hh = h * (0.55 + rng() * 0.45);
    b.box(len / n + 0.04, hh, 0.9, color, x + cx * t * len, y + hh / 2, z + sx * t * len, 0, rotY, 0, 0x9c8c70);
  }
  c.physics.staticBox(x, y + h * 0.35, z, len / 2, h * 0.35, 0.45, rotY);
}

export function fence(c: PropCtx, x1: number, z1: number, x2: number, z2: number, y: number) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / 1.8));
  const rot = Math.atan2(-(z2 - z1), x2 - x1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    c.b.box(0.14, 1.0, 0.14, 0x8a6a48, x1 + (x2 - x1) * t, y + 0.5, z1 + (z2 - z1) * t, 0, rot, 0);
  }
  c.b.box(len, 0.1, 0.08, 0x9c7a54, (x1 + x2) / 2, y + 0.75, (z1 + z2) / 2, 0, rot, 0);
  c.b.box(len, 0.1, 0.08, 0x9c7a54, (x1 + x2) / 2, y + 0.4, (z1 + z2) / 2, 0, rot, 0);
  c.physics.staticBox((x1 + x2) / 2, y + 0.5, (z1 + z2) / 2, len / 2, 0.5, 0.1, rot);
}

export function house(c: PropCtx, x: number, y: number, z: number, rotY = 0, roof = 0xd45a3c) {
  const { b } = c;
  const m = (lx: number, ly: number, lz: number) => {
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    return [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs] as const;
  };
  b.box(5.4, 0.5, 4.6, 0x9a938a, x, y + 0.1, z, 0, rotY, 0);
  b.box(5, 3, 4.2, 0xf1e6cc, x, y + 1.7, z, 0, rotY, 0, 0xdccfae);
  // 木梁
  for (const sx of [-2.5, 2.5]) for (const sz of [-2.1, 2.1]) { const p = m(sx, 1.7, sz); b.box(0.24, 3.1, 0.24, 0x7a5236, p[0], p[1], p[2], 0, rotY, 0); }
  // 屋顶（四棱锥拉伸）
  const rg = new THREE.ConeGeometry(4.2, 2.6, 4, 1);
  rg.rotateY(Math.PI / 4);
  rg.scale(1, 1, 0.86);
  b.add(rg, roof, trs(x, y + 4.5, z, 0, rotY, 0), 0xf08a5a);
  let p = m(0, 1.2, 2.12); b.box(1.1, 2.0, 0.12, 0x7a5236, p[0], p[1], p[2], 0, rotY, 0);
  p = m(1.6, 2.0, 2.12); b.box(0.8, 0.8, 0.1, 0x8fd8ff, p[0], p[1], p[2], 0, rotY, 0);
  p = m(-1.6, 2.0, 2.12); b.box(0.8, 0.8, 0.1, 0x8fd8ff, p[0], p[1], p[2], 0, rotY, 0);
  p = m(1.5, 5.0, -0.8); b.box(0.6, 1.8, 0.6, 0x9a938a, p[0], p[1], p[2], 0, rotY, 0);
  c.physics.staticBox(x, y + 1.7, z, 2.5, 1.9, 2.1, rotY);
}

export function crate(c: PropCtx, x: number, y: number, z: number, s = 1) {
  const ry = c.rng() * TAU;
  c.b.box(s, s, s, 0xb08850, x, y + s / 2, z, 0, ry, 0, 0xc9a468);
  c.b.box(s * 1.04, s * 0.12, s * 1.04, 0x7a5a34, x, y + s * 0.9, z, 0, ry, 0);
  c.b.box(s * 1.04, s * 0.12, s * 1.04, 0x7a5a34, x, y + s * 0.1, z, 0, ry, 0);
  c.physics.staticBox(x, y + s / 2, z, s / 2, s / 2, s / 2, ry);
}

/** 灯柱（发光灯芯） */
export function lantern(c: PropCtx, x: number, y: number, z: number, color = 0xffc66a, h = 2.6) {
  c.b.box(0.5, 0.3, 0.5, 0x6a6a72, x, y + 0.15, z);
  c.b.cyl(0.08, 0.1, h, 5, 0x4a4a55, x, y + h / 2, z);
  c.b.box(0.5, 0.08, 0.5, 0x4a4a55, x, y + h, z);
  c.b.cone(0.36, 0.3, 4, 0x4a4a55, x, y + h + 0.62, z, 0, Math.PI / 4, 0);
  c.glow.box(0.3, 0.42, 0.3, color, x, y + h + 0.26, z);
  c.physics.staticCylinder(x, y + h / 2, z, h / 2, 0.2);
}

/** 发光水晶簇 */
export function crystals(c: PropCtx, x: number, y: number, z: number, s = 1, color = 0x7fe8ff, glow = true) {
  const tgt = glow ? c.glow : c.b;
  const n = 3 + Math.floor(c.rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = c.rng() * TAU, d = i === 0 ? 0 : (0.3 + c.rng() * 0.5) * s;
    const h = (i === 0 ? 2.2 : 0.8 + c.rng() * 1.1) * s;
    tgt.crystal(0.32 * s * (i === 0 ? 1 : 0.7), h, color, x + Math.cos(a) * d, y - 0.1, z + Math.sin(a) * d, (c.rng() - 0.5) * 0.5, a, (c.rng() - 0.5) * 0.5, 0xffffff);
  }
  c.physics.staticCylinder(x, y + s * 0.8, z, s * 0.8, 0.5 * s);
}

/** 冰刺 */
export function iceSpike(c: PropCtx, x: number, y: number, z: number, s = 1) {
  const n = 2 + Math.floor(c.rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = c.rng() * TAU, d = i === 0 ? 0 : (0.4 + c.rng() * 0.6) * s;
    c.b.cone(0.5 * s * (i === 0 ? 1 : 0.6), (i === 0 ? 3.4 : 1.2 + c.rng() * 1.2) * s, 5, 0x9fd0f0, x + Math.cos(a) * d, y + (i === 0 ? 1.6 : 0.6) * s, z + Math.sin(a) * d, (c.rng() - 0.5) * 0.3, a, (c.rng() - 0.5) * 0.3, 0xf4fcff);
  }
  c.physics.staticCylinder(x, y + s * 1.2, z, s * 1.2, 0.5 * s);
}

/** 风车塔身（叶片由 World 单独创建以便旋转）。返回叶片轴心位置 */
export function windmillBody(c: PropCtx, x: number, y: number, z: number, rotY = 0): THREE.Vector3 {
  const { b } = c;
  b.cyl(1.7, 2.5, 8, 8, 0xf1e6cc, x, y + 4, z, 0, 0, 0, 0xd8c8a4);
  b.cyl(2.7, 2.7, 0.5, 8, 0x9a938a, x, y + 0.25, z);
  b.cone(2.3, 2.4, 8, 0xd45a3c, x, y + 9.2, z, 0, 0, 0, 0xf08a5a);
  const fx = Math.sin(rotY), fz = Math.cos(rotY);
  b.box(1.0, 1.9, 0.14, 0x7a5236, x + fx * 2.3, y + 1.2, z + fz * 2.3, 0.08, rotY, 0);
  b.box(0.7, 0.7, 0.14, 0x8fd8ff, x + fx * 1.95, y + 5.2, z + fz * 1.95, 0, rotY, 0);
  b.cyl(0.22, 0.22, 1.4, 6, 0x6b4a32, x + fx * 2.0, y + 7.6, z + fz * 2.0, Math.PI / 2, rotY, 0);
  c.physics.staticCylinder(x, y + 4, z, 4, 2.3);
  return new THREE.Vector3(x + fx * 2.7, y + 7.6, z + fz * 2.7);
}

export function windmillBlades(): THREE.BufferGeometry {
  const b = new MeshBuilder(0.04, 5);
  b.cyl(0.35, 0.35, 0.4, 6, 0x6b4a32, 0, 0, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    b.box(0.16, 5.4, 0.12, 0x7a5236, Math.sin(a) * 2.7, Math.cos(a) * 2.7, 0, 0, 0, -a);
    b.box(1.3, 3.8, 0.05, 0xf6efe0, Math.sin(a) * 3.2 + Math.cos(a) * 0.72, Math.cos(a) * 3.2 - Math.sin(a) * 0.72, 0.05, 0, 0, -a, 0xe0d4b8);
  }
  return b.build();
}

/** 草丛实例几何体：三片交叉草叶 */
export function grassTuftGeo(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const blade = (a: number, w: number, h: number, lean: number) => {
    const cx = Math.cos(a), sz = Math.sin(a);
    const lx = -sz * lean, lz = cx * lean;
    const pts = [[-cx * w, 0, -sz * w], [cx * w, 0, sz * w], [lx, h, lz]];
    for (const p of pts) { pos.push(p[0], p[1], p[2]); const k = p[1] > 0 ? 1.0 : 0.7; col.push(k, k, k); }
  };
  blade(0, 0.13, 0.62, 0.16); blade(1.05, 0.12, 0.5, -0.14); blade(2.1, 0.13, 0.56, 0.12);
  blade(0.5, 0.1, 0.4, -0.2); blade(1.6, 0.1, 0.45, 0.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1; // 法线统一朝上，让草与地面受光一致
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

/** 带风摆动 + 玩家拨开效果的草材质 */
export function grassMaterial(uniforms: { uTime: { value: number }; uPlayer: { value: THREE.Vector3 } }): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uPlayer = uniforms.uPlayer;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float hk = position.y * 1.6;
          float w = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.27) + 0.5 * sin(uTime * 3.1 + ip.x * 0.9 - ip.z * 0.6);
          transformed.x += w * 0.12 * hk;
          transformed.z += cos(uTime * 1.3 + ip.z * 0.4) * 0.07 * hk;
          vec3 dp = ip - uPlayer;
          float pd = length(dp.xz);
          float push = (1.0 - smoothstep(0.2, 1.5, pd)) * step(abs(dp.y), 1.5);
          transformed.xz += normalize(dp.xz + 0.0001) * push * 0.45 * hk;
          transformed.y -= push * 0.22 * hk;
        #endif`);
    // 双面渲染时背面法线会被翻转成朝下而变黑：翻回去，让草叶两面受光一致
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif');
  };
  return m;
}
