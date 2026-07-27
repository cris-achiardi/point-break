/**
 * The look: render the whole scene into a ~240p buffer, then blow it up with nearest
 * sampling through a posterise + ordered-dither pass. That single trick does most of the
 * work of making modern GPU output read as a 1996 console.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
precision mediump float;
uniform sampler2D tDiffuse;
uniform float uLevels;
uniform float uDark;      // barrel / wipeout darkening
uniform vec3  uTint;
uniform float uTintAmt;
uniform float uVignette;
uniform vec2  uRes;
varying vec2 vUv;

// 4x4 Bayer matrix
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == i) v = m[k]; }
  return v / 16.0;
}

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;

  c = mix(c, uTint, uTintAmt);
  c *= uDark;

  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.6;

  float b = (bayer(vUv * uRes) - 0.5) / uLevels;
  c = floor((c + b) * uLevels + 0.5) / uLevels;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export class Pixelizer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;

    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    });

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uLevels: { value: CFG.render.levels },
        uDark: { value: 1 },
        uTint: { value: new THREE.Color(0x0b2a3a) },
        uTintAmt: { value: 0 },
        uVignette: { value: 0.35 },
        uRes: { value: new THREE.Vector2(320, 240) },
      },
    });

    this.quadScene = new THREE.Scene();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quadScene.add(new THREE.Mesh(g, this.mat));
    this.quadCam = new THREE.Camera();

    this.resize();
  }

  resize() {
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    this.renderer.setSize(w, h, false);
    const rh = CFG.render.baseH;
    const rw = Math.min(CFG.render.maxW, Math.round((rh * w) / h / 2) * 2);
    this.target.setSize(rw, rh);
    this.mat.uniforms.uRes.value.set(rw, rh);
    this.aspect = w / h;
    return this.aspect;
  }

  set dark(v) { this.mat.uniforms.uDark.value = v; }
  set tintAmt(v) { this.mat.uniforms.uTintAmt.value = v; }
  set vignette(v) { this.mat.uniforms.uVignette.value = v; }
  tint(hex) { this.mat.uniforms.uTint.value.setHex(hex); }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
