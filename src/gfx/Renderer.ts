import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Settings } from '../core/Save';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uChroma: { value: 0 },
    uVignette: { value: 0.55 },
    uSat: { value: 1.08 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDamage, uLowHp, uChroma, uVignette, uSat, uFlash, uTime;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * (uChroma * 0.035 + 0.0015) * (0.4 + d * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(l), col, uSat), 0.0);
      float vig = smoothstep(0.08, 0.62, d);
      col *= 1.0 - vig * uVignette;
      float pulse = 0.6 + 0.4 * sin(uTime * 5.0);
      float edge = smoothstep(0.06, 0.45, d);
      col = mix(col, vec3(0.75, 0.03, 0.05) * (0.4 + l), edge * clamp(uDamage + uLowHp * pulse * 0.45, 0.0, 0.85));
      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Bloom 之前清理一次画面：把 NaN / Inf / 负值收回到安全范围，避免个别异常像素被模糊扩散成黑块 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: FinalShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, vec3(0.0), vec3(64.0)), 1.0);
    }`,
};

const QUALITY = {
  low: { ratio: 0.7, shadow: 1024, bloom: false, msaa: 0 },
  medium: { ratio: 1.0, shadow: 2048, bloom: true, msaa: 2 },
  high: { ratio: 1.5, shadow: 2048, bloom: true, msaa: 4 },
} as const;

export class Renderer {
  renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private final: ShaderPass | null = null;
  private usePost = true;
  private msaa = 4;
  shadowSize = 2048;
  /** 后期参数（由 Game 每帧写入） */
  fx = { damage: 0, lowHp: 0, chroma: 0, flash: 0, bloom: 0.5, time: 0 };

  constructor(public canvas: HTMLCanvasElement, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;
  }

  applySettings(s: Settings) {
    const q = QUALITY[s.quality];
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(s.quality === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 1) * q.ratio);
    this.renderer.shadowMap.enabled = s.shadows;
    this.shadowSize = q.shadow;
    const wantPost = s.postfx;
    if (wantPost !== this.usePost || this.msaa !== q.msaa || (wantPost && !this.composer)) {
      this.usePost = wantPost;
      this.msaa = q.msaa;
      this.disposeComposer();
    }
    if (this.usePost && !this.composer) this.buildComposer();
    if (this.bloom) this.bloom.enabled = q.bloom;
    this.resize();
  }

  private buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.7, 0.92);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }
  private disposeComposer() {
    if (!this.composer) return;
    for (const p of this.composer.passes) p.dispose?.();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.final = null;
    this.renderPass = null;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  render() {
    if (this.composer && this.final) {
      const u = this.final.uniforms;
      u.uDamage.value = this.fx.damage;
      u.uLowHp.value = this.fx.lowHp;
      u.uChroma.value = this.fx.chroma;
      u.uFlash.value = this.fx.flash;
      u.uTime.value = this.fx.time;
      if (this.bloom) this.bloom.strength = this.fx.bloom;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
  dispose() {
    this.disposeComposer();
    this.renderer.dispose();
  }
}
