/**
 * 池化粒子系统：两层 THREE.Points（叠加发光 / 普通混合），CPU 模拟，零运行时分配。
 */
import * as THREE from 'three';

export interface EmitOpts {
  n?: number;
  x: number; y: number; z: number;
  /** 出生位置随机半径 */
  spread?: number;
  /** 基础速度 */
  vx?: number; vy?: number; vz?: number;
  /** 随机方向速度 */
  speed?: number;
  /** 随机速度仅限水平面（适合尘土环） */
  flat?: boolean;
  life?: number;
  size?: number;
  sizeEnd?: number;
  color: number;
  color2?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  additive?: boolean;
}

const VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main(){
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(220.0, aSize * uScale / max(0.1, -mv.z));
  }`;
const FRAG_ADD = /* glsl */ `
  varying vec4 vColor;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor.rgb * (a * a * 1.6 + smoothstep(0.16, 0.0, d)), vColor.a * a);
  }`;
const FRAG_NORMAL = /* glsl */ `
  varying vec4 vColor;
  void main(){
    vec2 p = abs(gl_PointCoord - 0.5);
    if (p.x + p.y > 0.5) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a);
  }`;

class Layer {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private cursor = 0;
  alive = 0;

  constructor(private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_ADD : FRAG_NORMAL,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  emit(o: EmitOpts, c0: THREE.Color, c1: THREE.Color) {
    const n = o.n ?? 1;
    const spread = o.spread ?? 0;
    const speed = o.speed ?? 0;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      // 随机单位方向
      let dx = Math.random() * 2 - 1, dy = o.flat ? 0 : Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const sr = spread * Math.cbrt(Math.random());
      this.pos[i3] = o.x + dx * sr;
      this.pos[i3 + 1] = o.y + dy * sr;
      this.pos[i3 + 2] = o.z + dz * sr;
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.vel[i3] = (o.vx ?? 0) + dx * sp;
      this.vel[i3 + 1] = (o.vy ?? 0) + dy * sp;
      this.vel[i3 + 2] = (o.vz ?? 0) + dz * sp;
      const life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      const s = (o.size ?? 0.2) * (0.7 + Math.random() * 0.6);
      this.s0[i] = s;
      this.s1[i] = o.sizeEnd !== undefined ? o.sizeEnd * (s / (o.size ?? 0.2)) : 0;
      this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
      this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
      this.a0[i] = o.alpha ?? 1;
    }
  }

  update(dt: number) {
    let alive = 0;
    const { pos, vel, life, maxLife, col, size } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const i3 = i * 3;
      const i4 = i * 4;
      if (life[i] <= 0) { size[i] = 0; col[i4 + 3] = 0; continue; }
      alive++;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - this.grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = 1 - life[i] / maxLife[i];
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      // 淡入淡出
      col[i4 + 3] = this.a0[i] * Math.min(1, t * 8) * Math.min(1, (1 - t) * 2.5);
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.size.fill(0);
  }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

export class Particles {
  private add: Layer;
  private normal: Layer;
  private c0 = new THREE.Color();
  private c1 = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    this.add = new Layer(2600, true);
    this.normal = new Layer(1800, false);
    scene.add(this.add.points, this.normal.points);
  }
  emit(o: EmitOpts) {
    this.c0.set(o.color);
    this.c1.set(o.color2 ?? o.color);
    (o.additive === false ? this.normal : this.add).emit(o, this.c0, this.c1);
  }
  update(dt: number, camera: THREE.PerspectiveCamera, viewportH: number) {
    const scale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.add.mat.uniforms.uScale.value = scale;
    this.normal.mat.uniforms.uScale.value = scale;
    this.add.update(dt);
    this.normal.update(dt);
  }
  get count() { return this.add.alive + this.normal.alive; }
  clear() { this.add.clear(); this.normal.clear(); }
  dispose() {
    this.scene.remove(this.add.points, this.normal.points);
    this.add.dispose();
    this.normal.dispose();
  }
}
