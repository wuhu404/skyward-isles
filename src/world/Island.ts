/**
 * 程序化浮空岛：极坐标网格顶面（带噪声起伏、可压平区域、道路着色）+ 向下收拢的岩石底座。
 * 同一份顶点既生成扁平着色的渲染网格，也生成 Rapier trimesh 碰撞体。
 */
import * as THREE from 'three';
import { fbm, hash2, lerp, clamp01, makeRng } from '../core/math';

export interface IslandPalette {
  top: number; top2: number; edge: number; path: number;
  cliff: number; cliff2: number; under: number;
}
export interface IslandOpts {
  x: number; y: number; z: number; r: number;
  seed: number;
  palette: IslandPalette;
  depth?: number;
  hill?: number;
  hillFreq?: number;
  edgeVar?: number;
  /** 压平区域 [x, z, 半径]（世界坐标） */
  flats?: [number, number, number][];
  /** 平滑土丘 [x, z, 半径, 高度] */
  mounds?: [number, number, number, number][];
  /** 道路 [x1, z1, x2, z2, 宽度] */
  paths?: [number, number, number, number, number][];
}

const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const _ca = new THREE.Color(), _cb = new THREE.Color(), _cc = new THREE.Color();

function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1, dz = z2 - z1;
  const t = clamp01(((px - x1) * dx + (pz - z1) * dz) / Math.max(1e-6, dx * dx + dz * dz));
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

export class Island {
  readonly x: number; readonly y: number; readonly z: number; readonly r: number;
  readonly geometry: THREE.BufferGeometry;
  readonly colVerts: Float32Array;
  readonly colIdx: Uint32Array;
  private rings: number;
  private segs: number;
  private top: Float32Array;
  private edgeVar: number;
  private seed: number;

  constructor(readonly o: IslandOpts) {
    this.x = o.x; this.y = o.y; this.z = o.z; this.r = o.r;
    this.seed = o.seed;
    this.edgeVar = o.edgeVar ?? 0.16;
    const rings = this.rings = Math.max(3, Math.round(o.r / 2.1));
    const segs = this.segs = Math.max(9, Math.round(o.r * 1.55));
    const depth = o.depth ?? o.r * 1.05 + 3;
    const pal = o.palette;
    const rng = makeRng(o.seed * 977 + 13);

    const verts: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    const pushV = (x: number, y: number, z: number, c: THREE.Color) => { verts.push(x, y, z); cols.push(c.r, c.g, c.b); return verts.length / 3 - 1; };

    // ---------- 顶面 ----------
    const topColor = (x: number, z: number, t: number) => {
      const n = fbm(x * 0.09 + 31, z * 0.09 + 17, this.seed, 2);
      _ca.set(pal.top).lerp(_cb.set(pal.top2), smooth((n - 0.3) * 2.2));
      if (t > 0.86) _ca.lerp(_cb.set(pal.edge), smooth((t - 0.86) / 0.14) * 0.85);
      if (o.paths) {
        let k = 0;
        for (const p of o.paths) k = Math.max(k, 1 - smooth((segDist(x, z, p[0], p[1], p[2], p[3]) - p[4] * 0.35) / (p[4] * 0.65)));
        if (k > 0) _ca.lerp(_cb.set(pal.path), k * 0.92);
      }
      return _ca;
    };
    pushV(o.x, this.heightFn(o.x, o.z, 0), o.z, topColor(o.x, o.z, 0));
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const rr = t * this.edgeR(th);
        const x = o.x + Math.cos(th) * rr, z = o.z + Math.sin(th) * rr;
        pushV(x, this.heightFn(x, z, t), z, topColor(x, z, t));
      }
    }
    const vi = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (j % segs));
    for (let j = 0; j < segs; j++) {
      idx.push(0, vi(1, j + 1), vi(1, j));
      for (let i = 1; i < rings; i++) {
        const a = vi(i, j), b = vi(i, j + 1), c = vi(i + 1, j), d = vi(i + 1, j + 1);
        idx.push(a, b, c, b, d, c);
      }
    }
    this.top = new Float32Array(verts);
    const topTris = idx.length / 3;

    // ---------- 悬崖与底座 ----------
    const K = Math.max(3, Math.min(6, Math.round(o.r / 4.5)));
    const lip = Math.min(1.5, 0.5 + o.r * 0.06);
    const layerStart: number[] = [];
    for (let k = 0; k <= K; k++) {
      layerStart.push(verts.length / 3);
      const u = k / K;
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const er = this.edgeR(th);
        const nz = hash2(j * 7.1 + k * 3.3, k * 5.7, this.seed);
        let rr: number, y: number;
        if (k === 0) { rr = er * 0.985; y = o.y - lip; }
        else {
          rr = er * (Math.pow(1 - u, 0.62) * (0.8 + nz * 0.3)) * 0.93 + 0.15;
          y = o.y - lip - depth * Math.pow(u, 1.25) * (0.85 + nz * 0.3);
        }
        _cc.set(pal.cliff).lerp(_cb.set(pal.cliff2), smooth(u * 1.15 + (nz - 0.5) * 0.25));
        if (k === K) _cc.lerp(_cb.set(pal.under), 0.6);
        pushV(o.x + Math.cos(th) * rr, y, o.z + Math.sin(th) * rr, _cc);
      }
    }
    _cc.set(pal.under);
    const apex = pushV(o.x + (rng() - 0.5) * o.r * 0.15, o.y - lip - depth * 1.12, o.z + (rng() - 0.5) * o.r * 0.15, _cc);
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      // 顶面边缘 → 崖唇
      const a = vi(rings, j), b = vi(rings, j1), c = layerStart[0] + j, d = layerStart[0] + j1;
      idx.push(a, b, c, b, d, c);
      for (let k = 0; k < K; k++) {
        const p = layerStart[k] + j, q = layerStart[k] + j1, r2 = layerStart[k + 1] + j, s = layerStart[k + 1] + j1;
        idx.push(p, q, r2, q, s, r2);
      }
      idx.push(layerStart[K] + j, layerStart[K] + j1, apex);
    }

    this.colVerts = new Float32Array(verts);
    this.colIdx = new Uint32Array(idx);

    // ---------- 扁平着色渲染网格 ----------
    const nTri = idx.length / 3;
    const pos = new Float32Array(nTri * 9);
    const col = new Float32Array(nTri * 9);
    for (let t = 0; t < nTri; t++) {
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const jit = t < topTris ? 0.94 + rng() * 0.12 : 0.86 + rng() * 0.28;
      const r = ((cols[i0] + cols[i1] + cols[i2]) / 3) * jit;
      const g = ((cols[i0 + 1] + cols[i1 + 1] + cols[i2 + 1]) / 3) * jit;
      const b = ((cols[i0 + 2] + cols[i1 + 2] + cols[i2 + 2]) / 3) * jit;
      const src = [i0, i1, i2];
      for (let k = 0; k < 3; k++) {
        const o9 = t * 9 + k * 3;
        pos[o9] = verts[src[k]]; pos[o9 + 1] = verts[src[k] + 1]; pos[o9 + 2] = verts[src[k] + 2];
        col[o9] = r; col[o9 + 1] = g; col[o9 + 2] = b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.geometry = g;
  }

  /** 指定方向上的岛屿边缘半径 */
  edgeR(th: number): number {
    const n = fbm(Math.cos(th) * 1.4 + 9 + this.seed * 0.37, Math.sin(th) * 1.4 + 5, this.seed, 2);
    return this.r * (1 - this.edgeVar * n);
  }
  /** 边缘内侧 inset 米处的世界坐标点（y 为岛基准高度） */
  edgePoint(th: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const rr = this.edgeR(th) - inset;
    return out.set(this.x + Math.cos(th) * rr, this.y, this.z + Math.sin(th) * rr);
  }

  private heightFn(x: number, z: number, t: number): number {
    const o = this.o;
    let h = 0;
    const hill = o.hill ?? 0;
    if (hill > 0) {
      const f = o.hillFreq ?? 0.06;
      h = (fbm(x * f + 11, z * f + 7, this.seed, 3) - 0.42) * 2 * hill;
    }
    if (o.mounds) for (const m of o.mounds) {
      const d = Math.hypot(x - m[0], z - m[1]) / m[2];
      if (d < 1) { const k = 1 - d * d; h += m[3] * k * k; }
    }
    if (o.flats) for (const f of o.flats) h *= smooth((Math.hypot(x - f[0], z - f[1]) - f[2]) / 5);
    if (o.paths) for (const p of o.paths) h *= lerp(0.35, 1, smooth((segDist(x, z, p[0], p[1], p[2], p[3]) - p[4] * 0.5) / 4));
    // 边缘压平，保证跳跃落点高度可预期
    h *= 1 - smooth((t - 0.68) / 0.3);
    return this.y + h;
  }

  /** 顶面精确高度（与渲染 / 碰撞三角形一致）；不在岛上返回 null */
  heightAt(x: number, z: number): number | null {
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz > this.r * this.r) return null;
    const segs = this.segs, rings = this.rings, T = this.top;
    let th = Math.atan2(dz, dx);
    if (th < 0) th += Math.PI * 2;
    const j = Math.min(segs - 1, Math.floor((th / (Math.PI * 2)) * segs));
    const vi = (i: number, jj: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (jj % segs)) * 3;
    const tri = (a: number, b: number, c: number): number | null => {
      const ax = T[a], az = T[a + 2], bx = T[b], bz = T[b + 2], cx = T[c], cz = T[c + 2];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) return null;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
      const w = 1 - u - v;
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) return null;
      return u * T[a + 1] + v * T[b + 1] + w * T[c + 1];
    };
    let h = tri(0, vi(1, j + 1), vi(1, j));
    if (h !== null) return h;
    for (let i = 1; i < rings; i++) {
      const a = vi(i, j), b = vi(i, j + 1), c = vi(i + 1, j), d = vi(i + 1, j + 1);
      h = tri(a, b, c);
      if (h !== null) return h;
      h = tri(b, d, c);
      if (h !== null) return h;
    }
    return null;
  }

  /** 点是否在岛面上且距边缘至少 margin 米 */
  contains(x: number, z: number, margin = 0): boolean {
    const dx = x - this.x, dz = z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.r) return false;
    return d <= this.edgeR(Math.atan2(dz, dx)) - margin;
  }
}

export const PALETTES = {
  meadow: { top: 0x63b848, top2: 0x8fd160, edge: 0xb4dc74, path: 0xdcc48e, cliff: 0xa98a64, cliff2: 0x5d4a40, under: 0x3d3230 },
  ruins: { top: 0xcfa85e, top2: 0xb0a455, edge: 0xe2c078, path: 0xe8d4a4, cliff: 0xb87a4c, cliff2: 0x6b3f30, under: 0x402a26 },
  frost: { top: 0xe9f3ff, top2: 0xc4dcf5, edge: 0xffffff, path: 0xa9c6e6, cliff: 0x86a6cc, cliff2: 0x3f5880, under: 0x263354 },
  storm: { top: 0x4b4f6b, top2: 0x3a3c56, edge: 0x676c8c, path: 0x7a7399, cliff: 0x33344e, cliff2: 0x1c1c30, under: 0x121220 },
} satisfies Record<string, IslandPalette>;
