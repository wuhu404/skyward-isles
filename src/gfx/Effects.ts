/**
 * 网格特效：刀光、冲击波环、地面预警圈、光柱、爆裂球、武器拖尾。
 * 每种特效都有对象池，材质实例随池复用，结束时统一释放。
 */
import * as THREE from 'three';
import { clamp01, easeOutCubic } from '../core/math';

type FxUpdate = (mesh: THREE.Mesh, t: number) => void;
interface ActiveFx { mesh: THREE.Mesh; kind: string; age: number; life: number; update: FxUpdate; }

const SLASH_VERT = /* glsl */ `
  attribute float aArc; attribute float aRad;
  varying float vArc; varying float vRad;
  void main(){ vArc = aArc; vRad = aRad; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SLASH_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uT; uniform float uDir;
  varying float vArc; varying float vRad;
  void main(){
    float arc = uDir > 0.0 ? vArc : 1.0 - vArc;
    float lead = uT * 1.9;
    float sweep = smoothstep(lead - 0.85, lead, arc) * step(arc, lead);
    float radial = pow(vRad, 2.2) * smoothstep(1.0, 0.94, vRad);
    float fade = 1.0 - smoothstep(0.45, 1.0, uT);
    float a = sweep * radial * fade * smoothstep(0.0, 0.08, arc) * smoothstep(1.0, 0.9, arc);
    gl_FragColor = vec4(uColor * (1.0 + 2.0 * pow(vRad, 6.0)), a);
  }`;
const TELE_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uT; uniform float uFade;
  varying vec2 vUv;
  void main(){
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float border = smoothstep(0.9, 0.95, r);
    float fill = step(r, uT) * 0.3;
    float edge = smoothstep(uT - 0.08, uT, r) * step(r, uT) * 0.5;
    gl_FragColor = vec4(uColor, (border * 0.9 + fill + edge + 0.1) * uFade);
  }`;
const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PILLAR_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uFade;
  varying vec2 vUv;
  void main(){
    float a = pow(1.0 - vUv.y, 1.5) * uFade;
    gl_FragColor = vec4(uColor * 1.6, a);
  }`;

export class Effects {
  private active: ActiveFx[] = [];
  private pools = new Map<string, THREE.Mesh[]>();
  private created: THREE.Mesh[] = [];
  private geos: Record<string, THREE.BufferGeometry>;

  constructor(private scene: THREE.Scene) {
    // 刀光弧面（XZ 平面，朝 +Z 展开）
    const N = 28;
    const pos: number[] = [], arc: number[] = [], rad: number[] = [], idx: number[] = [];
    const len = Math.PI * 1.05;
    for (let i = 0; i <= N; i++) {
      const a = -len / 2 + (len * i) / N;
      for (const [r, rv] of [[0.45, 0], [1, 1]] as const) {
        pos.push(-Math.sin(a) * r, 0, Math.cos(a) * r);
        arc.push(i / N);
        rad.push(rv);
      }
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const slash = new THREE.BufferGeometry();
    slash.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    slash.setAttribute('aArc', new THREE.Float32BufferAttribute(arc, 1));
    slash.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 1));
    slash.setIndex(idx);
    const ring = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const pillar = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
    const sphere = new THREE.IcosahedronGeometry(1, 2);
    this.geos = { slash, ring, disc, pillar, sphere };
  }

  private acquire(kind: string, make: () => THREE.Mesh): THREE.Mesh {
    let pool = this.pools.get(kind);
    if (!pool) { pool = []; this.pools.set(kind, pool); }
    let m = pool.pop();
    if (!m) {
      m = make();
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.created.push(m);
    }
    m.visible = true;
    this.scene.add(m);
    return m;
  }
  private start(kind: string, mesh: THREE.Mesh, life: number, update: FxUpdate) {
    update(mesh, 0);
    this.active.push({ mesh, kind, age: 0, life, update });
  }

  /** 刀光：yaw 朝向，roll 倾斜，dir 决定扫过方向 */
  slash(x: number, y: number, z: number, yaw: number, opts: { roll?: number; pitch?: number; scale?: number; color?: number; dir?: number; life?: number } = {}) {
    const m = this.acquire('slash', () => new THREE.Mesh(this.geos.slash, new THREE.ShaderMaterial({
      vertexShader: SLASH_VERT, fragmentShader: SLASH_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uDir: { value: 1 } },
    })));
    const mat = m.material as THREE.ShaderMaterial;
    (mat.uniforms.uColor.value as THREE.Color).set(opts.color ?? 0xbff6ff);
    mat.uniforms.uDir.value = opts.dir ?? 1;
    m.position.set(x, y, z);
    m.rotation.order = 'YXZ';
    m.rotation.set(opts.pitch ?? 0, yaw, opts.roll ?? 0);
    const s = opts.scale ?? 2.4;
    this.start('slash', m, opts.life ?? 0.26, (mesh, t) => {
      mat.uniforms.uT.value = t;
      mesh.scale.setScalar(s * (0.85 + 0.25 * easeOutCubic(t)));
    });
  }

  /** 扩散冲击波环 */
  ring(x: number, y: number, z: number, r0: number, r1: number, life: number, color = 0xffffff, opacity = 0.9) {
    const m = this.acquire('ring', () => new THREE.Mesh(this.geos.ring, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    })));
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    m.position.set(x, y, z);
    m.rotation.set(0, 0, 0);
    this.start('ring', m, life, (mesh, t) => {
      const r = r0 + (r1 - r0) * easeOutCubic(t);
      mesh.scale.set(r, 1, r);
      mat.opacity = opacity * (1 - t) * (1 - t);
    });
    return m;
  }

  /** 地面预警圈：duration 秒内从圆心填满，随后消失 */
  telegraph(x: number, y: number, z: number, radius: number, duration: number, color = 0xff3b2f) {
    const m = this.acquire('tele', () => new THREE.Mesh(this.geos.disc, new THREE.ShaderMaterial({
      vertexShader: UV_VERT, fragmentShader: TELE_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uFade: { value: 1 } },
    })));
    const mat = m.material as THREE.ShaderMaterial;
    (mat.uniforms.uColor.value as THREE.Color).set(color);
    m.position.set(x, y + 0.12, z);
    m.rotation.set(0, 0, 0);
    m.scale.set(radius, 1, radius);
    this.start('tele', m, duration + 0.12, (_mesh, t) => {
      const tt = (t * (duration + 0.12)) / duration;
      mat.uniforms.uT.value = clamp01(tt);
      mat.uniforms.uFade.value = tt > 1 ? 0 : Math.min(1, tt * 6);
    });
    return m;
  }

  /** 光柱（拾取 / 雷击 / 检查点） */
  pillar(x: number, y: number, z: number, radius: number, height: number, life: number, color = 0xffffff) {
    const m = this.acquire('pillar', () => new THREE.Mesh(this.geos.pillar, new THREE.ShaderMaterial({
      vertexShader: UV_VERT, fragmentShader: PILLAR_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 1 } },
    })));
    const mat = m.material as THREE.ShaderMaterial;
    (mat.uniforms.uColor.value as THREE.Color).set(color);
    m.position.set(x, y, z);
    m.rotation.set(0, 0, 0);
    this.start('pillar', m, life, (mesh, t) => {
      const r = radius * (1 - 0.7 * t);
      mesh.scale.set(r, height, r);
      mat.uniforms.uFade.value = (1 - t) * Math.min(1, t * 12);
    });
  }

  /** 爆裂球 */
  burst(x: number, y: number, z: number, r0: number, r1: number, life: number, color = 0xffffff, opacity = 0.7) {
    const m = this.acquire('sphere', () => new THREE.Mesh(this.geos.sphere, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })));
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    m.position.set(x, y, z);
    this.start('sphere', m, life, (mesh, t) => {
      mesh.scale.setScalar(r0 + (r1 - r0) * easeOutCubic(t));
      mat.opacity = opacity * (1 - t);
    });
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.mesh.visible = false;
        this.scene.remove(f.mesh);
        this.pools.get(f.kind)!.push(f.mesh);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      } else f.update(f.mesh, t);
    }
  }
  clear() {
    for (const f of this.active) { f.mesh.visible = false; this.scene.remove(f.mesh); this.pools.get(f.kind)!.push(f.mesh); }
    this.active.length = 0;
  }
  dispose() {
    this.clear();
    for (const m of this.created) (m.material as THREE.Material).dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    this.created = [];
    this.pools.clear();
  }
}

/** 武器拖尾：记录剑根 / 剑尖轨迹生成带状网格 */
export class SwordTrail {
  mesh: THREE.Mesh;
  private N = 16;
  private pos: Float32Array;
  private alpha: Float32Array;
  private count = 0;
  private samples: number[] = [];
  active = false;

  constructor(color = 0x9ff3ff) {
    const N = this.N;
    this.pos = new Float32Array(N * 2 * 3);
    this.alpha = new Float32Array(N * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * 1.4, vA * vA); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }
  setColor(c: number) { ((this.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).set(c); }

  update(base: THREE.Vector3, tip: THREE.Vector3) {
    if (this.active) {
      this.samples.unshift(base.x, base.y, base.z, tip.x, tip.y, tip.z);
      if (this.samples.length > this.N * 6) this.samples.length = this.N * 6;
    } else if (this.samples.length) {
      this.samples.length = Math.max(0, this.samples.length - 12);
    }
    this.count = this.samples.length / 6;
    const g = this.mesh.geometry;
    this.mesh.visible = this.count >= 2;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.N; i++) {
      const s = Math.min(i, this.count - 1) * 6;
      const o = i * 6;
      for (let k = 0; k < 6; k++) this.pos[o + k] = this.samples[s + k];
      const a = i < this.count ? 1 - i / this.count : 0;
      this.alpha[i * 2] = a * 0.15;
      this.alpha[i * 2 + 1] = a;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
  reset() { this.samples.length = 0; this.mesh.visible = false; }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
