/**
 * 天空与大气：渐变天穹（太阳 / 星空 / 极光）、云层、太阳光与半球光。
 * 每个区域有一套 Atmosphere 预设，切换区域时所有参数平滑插值。
 */
import * as THREE from 'three';
import { damp, makeRng } from '../core/math';
import { MeshBuilder } from './geo';

export type ZoneId = 'meadow' | 'ruins' | 'frost' | 'storm';

export interface Atmosphere {
  top: THREE.Color; horizon: THREE.Color; bottom: THREE.Color;
  fog: THREE.Color; fogDensity: number;
  sun: THREE.Color; sunIntensity: number; sunDir: THREE.Vector3;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  cloud: THREE.Color;
  stars: number; aurora: number; exposure: number; bloom: number;
}
const A = (o: {
  top: number; horizon: number; bottom: number; fog: number; fogDensity: number; sun: number; sunIntensity: number;
  sunDir: [number, number, number]; hemiSky: number; hemiGround: number; hemiIntensity: number; cloud: number;
  stars: number; aurora: number; exposure: number; bloom: number;
}): Atmosphere => ({
  top: new THREE.Color(o.top), horizon: new THREE.Color(o.horizon), bottom: new THREE.Color(o.bottom),
  fog: new THREE.Color(o.fog), fogDensity: o.fogDensity,
  sun: new THREE.Color(o.sun), sunIntensity: o.sunIntensity, sunDir: new THREE.Vector3(...o.sunDir).normalize(),
  hemiSky: new THREE.Color(o.hemiSky), hemiGround: new THREE.Color(o.hemiGround), hemiIntensity: o.hemiIntensity,
  cloud: new THREE.Color(o.cloud), stars: o.stars, aurora: o.aurora, exposure: o.exposure, bloom: o.bloom,
});

export const ATMOS: Record<ZoneId, Atmosphere> = {
  meadow: A({
    top: 0x2f7fe0, horizon: 0xbfe4ff, bottom: 0x8fc4f2, fog: 0xbfe0fa, fogDensity: 0.0042,
    sun: 0xfff1d6, sunIntensity: 3.0, sunDir: [0.55, 0.72, 0.42],
    hemiSky: 0xcfe6ff, hemiGround: 0x86a86a, hemiIntensity: 1.25, cloud: 0xffffff,
    stars: 0, aurora: 0, exposure: 1.0, bloom: 0.38,
  }),
  ruins: A({
    top: 0x4a6fc0, horizon: 0xffcf96, bottom: 0xf0a878, fog: 0xf3c79a, fogDensity: 0.0052,
    sun: 0xffb56b, sunIntensity: 3.3, sunDir: [-0.7, 0.36, 0.5],
    hemiSky: 0xffe2c0, hemiGround: 0x9a6a4a, hemiIntensity: 1.05, cloud: 0xffe0c4,
    stars: 0, aurora: 0, exposure: 1.02, bloom: 0.45,
  }),
  frost: A({
    top: 0x0d1238, horizon: 0x5a6fd0, bottom: 0x2a3580, fog: 0x4a5cb4, fogDensity: 0.0058,
    sun: 0xb8ccff, sunIntensity: 2.1, sunDir: [0.35, 0.62, -0.6],
    hemiSky: 0x8fa4ff, hemiGround: 0x5a5a8a, hemiIntensity: 1.25, cloud: 0x9aa8e8,
    stars: 1, aurora: 1, exposure: 1.08, bloom: 0.62,
  }),
  storm: A({
    top: 0x07060f, horizon: 0x4a2f66, bottom: 0x1a1030, fog: 0x2d2040, fogDensity: 0.0085,
    sun: 0xc8a8ff, sunIntensity: 1.9, sunDir: [-0.3, 0.75, -0.4],
    hemiSky: 0x8a6fc8, hemiGround: 0x3a2a4a, hemiIntensity: 1.1, cloud: 0x4a3a66,
    stars: 0.25, aurora: 0, exposure: 1.05, bloom: 0.7,
  }),
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
  uniform float uStars, uAurora, uTime, uFlash;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(max(smoothstep(0.0, 0.85, h), 1e-5), 0.55))
      : mix(uHorizon, uBottom, smoothstep(0.0, 0.45, -h));
    float s = clamp(dot(d, uSunDir), 1e-5, 1.0);
    col += uSunColor * (smoothstep(0.9993, 0.9997, s) * 2.5 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
    if (uStars > 0.01 && h > -0.1) {
      vec3 p = d * 140.0;
      vec3 ip = floor(p);
      float r = hash(ip);
      float tw = 0.6 + 0.4 * sin(uTime * 2.0 + r * 60.0);
      float st = step(0.992, r) * (1.0 - smoothstep(0.05, 0.5, length(fract(p) - 0.5))) * tw;
      col += vec3(0.85, 0.9, 1.0) * st * uStars * smoothstep(-0.1, 0.25, h) * 1.6;
    }
    if (uAurora > 0.01 && h > 0.05) {
      float x = atan(d.x, d.z);
      float w = sin(x * 3.0 + uTime * 0.12) * 0.12 + sin(x * 7.0 - uTime * 0.2) * 0.05;
      float band = (1.0 - smoothstep(0.0, 0.16, abs(h - 0.42 - w))) + 0.6 * (1.0 - smoothstep(0.0, 0.1, abs(h - 0.62 + w * 1.4)));
      float rays = 0.55 + 0.45 * sin(x * 60.0 + sin(x * 9.0 + uTime * 0.5) * 4.0);
      vec3 ac = mix(vec3(0.15, 1.0, 0.65), vec3(0.6, 0.35, 1.0), smoothstep(0.3, 0.7, h));
      col += ac * band * rays * uAurora * 0.55;
    }
    col += vec3(0.75, 0.7, 1.0) * uFlash * (0.25 + 0.5 * smoothstep(0.0, 0.8, h));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }`;

export class Sky {
  cur: Atmosphere = cloneAtmo(ATMOS.meadow);
  private target: Atmosphere = ATMOS.meadow;
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  fog = new THREE.FogExp2(0xffffff, 0.004);
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshLambertMaterial;
  private cloudData: { x: number; y: number; z: number; s: number; sy: number; ry: number; speed: number }[] = [];
  private time = 0;
  /** 闪电亮度（风暴区域 / Boss 战） */
  flash = 0;
  private flashTimer = 3;
  lightningEnabled = false;
  onThunder: (() => void) | null = null;
  private dummy = new THREE.Object3D();

  constructor(private scene: THREE.Scene) {
    scene.fog = this.fog;
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 160;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
        uStars: { value: 0 }, uAurora: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // 云朵：一个 InstancedMesh 搞定全部云层
    const mb = new MeshBuilder(0.03, 11);
    const rng = makeRng(99);
    for (let i = 0; i < 7; i++) {
      const r = rng.range(0.55, 1.0);
      mb.ico(r, 1, 0xffffff, rng.range(-1.6, 1.6), rng.range(-0.1, 0.25), rng.range(-0.7, 0.7), 1.25, 0.62, 1);
    }
    const geo = mb.build();
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.22, transparent: true, opacity: 0.94 });
    const COUNT = 150;
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMat, COUNT);
    this.clouds.frustumCulled = false;
    this.clouds.castShadow = false;
    this.clouds.receiveShadow = false;
    for (let i = 0; i < COUNT; i++) {
      const sea = i < 95; // 大部分铺在下方形成云海，其余漂浮在高空
      this.cloudData.push({
        x: rng.range(-380, 380),
        y: sea ? rng.range(-85, -48) : rng.range(55, 130),
        z: rng.range(-660, 220),
        s: sea ? rng.range(16, 38) : rng.range(7, 16),
        sy: rng.range(0.7, 1.1),
        ry: rng.range(0, Math.PI * 2),
        speed: rng.range(0.4, 1.6),
      });
    }
    scene.add(this.clouds);
    this.apply(1);
  }

  setZone(z: ZoneId, instant = false) {
    this.target = ATMOS[z];
    this.lightningEnabled = z === 'storm';
    if (instant) { this.cur = cloneAtmo(this.target); this.apply(1); }
  }

  private apply(k: number) {
    const c = this.cur, t = this.target;
    c.top.lerp(t.top, k); c.horizon.lerp(t.horizon, k); c.bottom.lerp(t.bottom, k);
    c.fog.lerp(t.fog, k); c.sun.lerp(t.sun, k); c.hemiSky.lerp(t.hemiSky, k); c.hemiGround.lerp(t.hemiGround, k);
    c.cloud.lerp(t.cloud, k);
    c.sunDir.lerp(t.sunDir, k).normalize();
    c.fogDensity += (t.fogDensity - c.fogDensity) * k;
    c.sunIntensity += (t.sunIntensity - c.sunIntensity) * k;
    c.hemiIntensity += (t.hemiIntensity - c.hemiIntensity) * k;
    c.stars += (t.stars - c.stars) * k;
    c.aurora += (t.aurora - c.aurora) * k;
    c.exposure += (t.exposure - c.exposure) * k;
    c.bloom += (t.bloom - c.bloom) * k;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    this.apply(1 - Math.exp(-1.4 * dt));
    const c = this.cur;

    // 闪电
    if (this.lightningEnabled) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 3 + Math.random() * 7;
        this.flash = 1;
        this.onThunder?.();
      }
    }
    this.flash = damp(this.flash, 0, 6, dt);
    const fl = this.flash * (0.6 + 0.4 * Math.sin(this.time * 70));

    const u = this.domeMat.uniforms;
    (u.uTop.value as THREE.Color).copy(c.top);
    (u.uHorizon.value as THREE.Color).copy(c.horizon);
    (u.uBottom.value as THREE.Color).copy(c.bottom);
    (u.uSunDir.value as THREE.Vector3).copy(c.sunDir);
    (u.uSunColor.value as THREE.Color).copy(c.sun);
    u.uStars.value = c.stars;
    u.uAurora.value = c.aurora;
    u.uTime.value = this.time;
    u.uFlash.value = fl;
    this.dome.position.copy(camera.position);

    this.fog.color.copy(c.fog);
    this.fog.density = c.fogDensity;
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunIntensity + fl * 2.5;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiIntensity + fl * 1.5;
    // 阴影相机跟随玩家，并对齐到纹素网格，避免阴影边缘游走
    const texel = 76 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fy = Math.round(focus.y / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + c.sunDir.x * 70, fy + c.sunDir.y * 70, fz + c.sunDir.z * 70);

    this.cloudMat.color.copy(c.cloud);
    this.cloudMat.emissive.copy(c.cloud);
    const d = this.dummy;
    for (let i = 0; i < this.cloudData.length; i++) {
      const cd = this.cloudData[i];
      cd.x += cd.speed * dt;
      if (cd.x > 380) cd.x = -380;
      d.position.set(cd.x, cd.y, cd.z);
      d.rotation.set(0, cd.ry, 0);
      d.scale.set(cd.s, cd.s * cd.sy * 0.55, cd.s);
      d.updateMatrix();
      this.clouds.setMatrixAt(i, d.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  setShadowSize(size: number) {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  dispose() {
    this.scene.remove(this.sun, this.sun.target, this.hemi, this.dome, this.clouds);
    this.sun.shadow.map?.dispose();
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.clouds.geometry.dispose();
    this.cloudMat.dispose();
    this.clouds.dispose();
    this.onThunder = null;
  }
}

function cloneAtmo(a: Atmosphere): Atmosphere {
  return {
    top: a.top.clone(), horizon: a.horizon.clone(), bottom: a.bottom.clone(), fog: a.fog.clone(), fogDensity: a.fogDensity,
    sun: a.sun.clone(), sunIntensity: a.sunIntensity, sunDir: a.sunDir.clone(), hemiSky: a.hemiSky.clone(),
    hemiGround: a.hemiGround.clone(), hemiIntensity: a.hemiIntensity, cloud: a.cloud.clone(), stars: a.stars,
    aurora: a.aurora, exposure: a.exposure, bloom: a.bloom,
  };
}
