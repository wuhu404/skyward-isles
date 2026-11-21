/**
 * 程序化低多边形建模工具：把大量带颜色的基础几何体合并成一个扁平着色的 BufferGeometry，
 * 既能获得 Low Poly 质感，又把 draw call 压到最低。
 */
import * as THREE from 'three';
import { makeRng, vnoise } from '../core/math';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private rng;
  constructor(private jitter = 0.05, seed = 7) {
    this.rng = makeRng(seed);
  }
  get triangleCount() { return this.pos.length / 9; }

  /** 加入一个几何体（会被消耗并释放）。color2 存在时按局部高度做渐变。 */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, color2?: THREE.ColorRepresentation, jitter = this.jitter): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    let y0 = 0;
    let y1 = 1;
    if (color2 !== undefined) {
      g.computeBoundingBox();
      y0 = g.boundingBox!.min.y;
      y1 = g.boundingBox!.max.y;
    }
    const src = g.getAttribute('position') as THREE.BufferAttribute;
    const localY: number[] = [];
    if (color2 !== undefined) for (let i = 0; i < src.count; i++) localY.push(src.getY(i));
    if (m) g.applyMatrix4(m);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    _c.set(color);
    if (color2 !== undefined) _c2.set(color2);
    for (let i = 0; i + 2 < p.count; i += 3) {
      const j = 1 + (this.rng() - 0.5) * 2 * jitter;
      let r = _c.r, gg = _c.g, b = _c.b;
      if (color2 !== undefined) {
        const t = ((localY[i] + localY[i + 1] + localY[i + 2]) / 3 - y0) / Math.max(1e-5, y1 - y0);
        r += (_c2.r - r) * t; gg += (_c2.g - gg) * t; b += (_c2.b - b) * t;
      }
      for (let k = 0; k < 3; k++) {
        this.pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
        this.col.push(r * j, gg * j, b * j);
      }
    }
    g.dispose();
    return this;
  }
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color2?: THREE.ColorRepresentation) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, trs(x, y, z, rx, ry, rz), color2);
  }
  cyl(rTop: number, rBot: number, h: number, seg: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color2?: THREE.ColorRepresentation) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), color, trs(x, y, z, rx, ry, rz), color2);
  }
  cone(r: number, h: number, seg: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color2?: THREE.ColorRepresentation) {
    return this.add(new THREE.ConeGeometry(r, h, seg, 1), color, trs(x, y, z, rx, ry, rz), color2);
  }
  ico(r: number, detail: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, color2?: THREE.ColorRepresentation) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, trs(x, y, z, 0, ry, 0, sx, sy, sz), color2);
  }
  /** 不规则岩石 */
  rock(r: number, seed: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, color2?: THREE.ColorRepresentation, detail = 1) {
    return this.add(rockGeo(r, seed, detail), color, trs(x, y, z, 0, ry, 0, sx, sy, sz), color2);
  }
  /** 八面体水晶 */
  crystal(r: number, h: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color2?: THREE.ColorRepresentation) {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(r, h / 2, r);
    g.translate(0, h / 2, 0);
    return this.add(g, color, trs(x, y, z, rx, ry, rz), color2, 0.12);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.pos = [];
    this.col = [];
    return g;
  }
}

export function rockGeo(r: number, seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1.7 / r;
    const d = 0.72 + 0.56 * vnoise(x * k + seed * 3.1 + 50, y * k + z * k * 1.3 + seed * 1.7 + 50, seed);
    p.setXYZ(i, x * d, y * d, z * d);
  }
  return g;
}

/** 全局共享材质库（整个游戏生命周期内只创建一次） */
export class Materials {
  world = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.0 });
  worldDouble = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, side: THREE.DoubleSide });
  metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.7 });
  private glowCache = new Map<string, THREE.MeshStandardMaterial>();
  private all: THREE.Material[] = [this.world, this.worldDouble, this.metal];

  /** 自发光材质（配合 Bloom） */
  glow(color: number, intensity = 2.2, base = 0x111111): THREE.MeshStandardMaterial {
    const key = `${color}:${intensity}:${base}`;
    let m = this.glowCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.4 });
      this.glowCache.set(key, m);
      this.all.push(m);
    }
    return m;
  }
  track<T extends THREE.Material>(m: T): T { this.all.push(m); return m; }
  dispose() {
    for (const m of this.all) m.dispose();
    this.all = [];
    this.glowCache.clear();
  }
}
