// Post-processing chains. Vinyl = bloom + depth of field + lens grade; Felt = tilt-shift miniature + warm grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShift = {
  uniforms: { tDiffuse: { value: null }, focusY: { value: 0.52 }, band: { value: 0.16 }, amount: { value: 7.0 }, res: { value: new THREE.Vector2(1280, 720) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float focusY, band, amount; uniform vec2 res; varying vec2 vUv;
    // the first pass after the scene render is also the safety net for the bloom that follows: one NaN/Inf pixel (a bad normal, a half-float overflow)
    // would be spread by the bloom blur over a big block of the frame, so non-finite taps are zeroed and everything is capped at 48
    vec4 safe(vec4 c){
      bvec4 bad = equal(floatBitsToUint(c) & uvec4(0x7f800000u), uvec4(0x7f800000u));
      return vec4(bad.x ? 0.0 : min(c.x, 48.0), bad.y ? 0.0 : min(c.y, 48.0), bad.z ? 0.0 : min(c.z, 48.0), bad.w ? 1.0 : min(c.w, 48.0));
    }
    void main(){
      float d = max(0.0, abs(vUv.y - focusY) - band);
      float rad = d * amount * 26.0;
      if (rad < 0.35) { gl_FragColor = safe(texture2D(tDiffuse, vUv)); return; }
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for(int i=0;i<40;i++){
        float fi = float(i);
        float r = sqrt((fi+0.5)/40.0) * rad;
        float a = fi * 2.39996;
        vec2 o = vec2(cos(a), sin(a)) * r / res;
        vec4 s = safe(texture2D(tDiffuse, vUv + o));
        float w = 1.0 + dot(s.rgb, vec3(0.33)) * 0.6;   // bright bokeh blooms
        acc += s * w; wsum += w;
      }
      gl_FragColor = acc / wsum;
    }`,
};

const Grade = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1280, 720) },
    vig: { value: 0.25 }, chroma: { value: 0.0015 }, grain: { value: 0.035 }, sat: { value: 1.08 }, contrast: { value: 1.04 },
    tint: { value: new THREE.Vector3(1.0, 1.0, 1.0) }, lift: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vig, chroma, grain, sat, contrast; uniform vec2 res; uniform vec3 tint, lift; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*17.0) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c,c);
      vec2 off = c * chroma * (1.0 + d*6.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col = (col - 0.5) * contrast + 0.5 + lift;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, sat) * tint;
      col *= 1.0 - vig * smoothstep(0.12, 0.62, d) ;
      col += (h(vUv*res) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};


// Film transitions, applied last (in display space).  All uniforms are set per frame by web/film/film.js as pure functions of the time
// distance to a cut: whip = horizontal/vertical motion blur (0..1, peaks on the cut), dip = mix toward dipColor (fade through a colour),
// flash = soft additive pop.  With everything at 0 the pass is a plain copy.  Only built when makePost(..., { trans: true }).
const Trans = {
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1280, 720) }, whip: { value: 0 }, whipDir: { value: new THREE.Vector2(1, 0) }, dip: { value: 0 }, dipColor: { value: new THREE.Vector3(0, 0, 0) }, flash: { value: 0 }, flashColor: { value: new THREE.Vector3(1.0, 0.94, 0.88) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float whip, dip, flash; uniform vec2 whipDir; uniform vec3 dipColor, flashColor; varying vec2 vUv;
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 col;
      if (whip > 0.002) {
        vec3 acc = vec3(0.0); float jit = hh(vUv * res) - 0.5;
        vec2 dir = whipDir * vec2(1.0, res.x / res.y);
        for (int i = 0; i < 24; i++) {
          float f = (float(i) + jit) / 23.0 - 0.5;
          acc += texture2D(tDiffuse, clamp(vUv + dir * f * whip * 0.24, 0.0, 1.0)).rgb;
        }
        col = acc / 24.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      col = mix(col, dipColor, dip);
      col += flashColor * flash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// The before/after slider.  tDiffuse is the picture the viewer ends up with ("after"), tOther the one it replaces ("before", rendered by film.js into a
// buffer).  The "after" picture lies behind a moving seam, a felt appliqué edge: pinked (zigzag) edge with a cream binding, a soft shadow falling
// on the "before" picture, and a hand-sewn running stitch in thread inset from the edge.  pos 0..1 moves the seam across the frame (0: all
// "before", 1: all "after"); ang tilts it from the vertical (radians); dir -1 makes the seam travel right to left.  Everything is in pixels of a
// 1080-line frame (scaled by res.y / 1080) and a pure function of the uniforms.
const Wipe = {
  uniforms: {
    tDiffuse: { value: null }, tOther: { value: null }, res: { value: new THREE.Vector2(1280, 720) }, time: { value: 0 },
    pos: { value: 0 }, ang: { value: 0.1 }, dir: { value: 1 }, amp: { value: 11 }, per: { value: 34 }, inset: { value: 15 }, thick: { value: 3.4 },
    dashL: { value: 26 }, dashG: { value: 15 }, shadow: { value: 0.6 }, thread: { value: new THREE.Vector3(1.0, 0.36, 0.66) }, binding: { value: new THREE.Vector3(0.99, 0.95, 0.88) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tOther; uniform vec2 res; uniform float time, pos, ang, dir, amp, per, inset, thick, dashL, dashG, shadow; uniform vec3 thread, binding; varying vec2 vUv;
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 A = texture2D(tDiffuse, vUv).rgb, B = texture2D(tOther, vUv).rgb;
      float k = res.y / 1080.0;
      vec2 c = vUv * res - 0.5 * res;
      vec2 n = vec2(cos(ang), sin(ang)) * dir, tg = vec2(-n.y, n.x);
      float s = dot(c, n), a = dot(c, tg);
      float span = 0.5 * (abs(n.x) * res.x + abs(n.y) * res.y) + 60.0 * k;
      float tri = abs(fract(a / (per * k)) - 0.5) * 2.0;
      float wob = k * (3.5 * sin(a * 0.0105 + 1.3) + 1.6 * sin(a * 0.034 + 0.4 + pos * 6.0));
      float d = s - (mix(-span, span, pos) + (tri - 0.5) * amp * k + wob);      // < 0: the "after" side, behind the seam
      float side = smoothstep(0.7, -0.7, d);
      // the "after" cloth throws a soft shadow onto the "before" picture (light from the upper left)
      vec3 col = B * (1.0 - shadow * exp(-max(d - 2.5 * k, 0.0) / (9.0 * k)) * (1.0 - side));
      vec3 fab = A;
      // cream binding just inside the pinked edge
      float rim = 1.0 - smoothstep(1.4 * k, 3.6 * k, -d);
      fab = mix(fab, binding, rim * 0.62 * side);
      // running stitch, each dash a little different (hand sewn): capsule distance in pixels
      float sd = d + inset * k, pd = (dashL + dashG) * k, cell = floor(a / pd + 0.5), lx = a - cell * pd;
      float r1 = hh(vec2(cell, 3.7)), r2 = hh(vec2(cell, 9.1));
      float L = dashL * k * (0.85 + 0.3 * r1), jy = (r2 - 0.5) * 2.4 * k, th = thick * k * 0.5;
      lx += sd * (r1 - 0.5) * 0.3;
      vec2 q = vec2(max(abs(lx) - (L * 0.5 - th), 0.0), sd - jy);
      float dist = length(q) - th, cov = 1.0 - smoothstep(-0.6, 0.6, dist);
      vec2 q2 = vec2(max(abs(lx + 1.2 * k) - (L * 0.5 - th), 0.0), sd - jy - 1.3 * k);
      float shd = 1.0 - smoothstep(-1.0 * k, 2.2 * k, length(q2) - th);
      fab *= 1.0 - 0.32 * shd * (1.0 - cov);
      float lit = 0.86 + 0.22 * clamp(-(sd - jy) / th, -1.0, 1.0) * 0.5 + 0.1 * (hh(floor(vec2(a, sd) * 0.8)) - 0.5);
      fab = mix(fab, thread * lit, cov * 0.96);
      col = mix(col, fab, side);
      col += (hh(vUv * res + time) - 0.5) * 0.03 * (1.0 - abs(side - 0.5) * 2.0 + step(abs(d), 6.0 * k));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function makePost(renderer, scene, camera, style, W, H, o = {}) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const P = {};
  if (style === 'felt') {
    P.tilt = new ShaderPass(TiltShift); P.tilt.uniforms.res.value.set(W, H); P.tilt.uniforms.band.value = o.band ?? 0.14; P.tilt.uniforms.amount.value = o.tilt ?? 6.5; P.tilt.uniforms.focusY.value = o.focusY ?? 0.5;
    composer.addPass(P.tilt);
    P.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.18, 0.5, 0.92); composer.addPass(P.bloom);
  } else {
    if (!o.noBokeh) { P.bokeh = new BokehPass(scene, camera, { focus: o.focus ?? 6.5, aperture: o.aperture ?? 0.00022, maxblur: o.maxblur ?? 0.011 }); composer.addPass(P.bokeh); }
    P.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), o.bloom ?? 0.28, 0.6, 0.93); composer.addPass(P.bloom);
  }
  composer.addPass(new OutputPass());
  P.grade = new ShaderPass(Grade); P.grade.uniforms.res.value.set(W, H);
  if (style === 'felt') { Object.assign(P.grade.uniforms, { vig: { value: 0.34 }, chroma: { value: 0.0006 }, grain: { value: 0.05 }, sat: { value: 0.98 }, contrast: { value: 1.03 } }); P.grade.uniforms.tint.value.set(1.02, 0.99, 0.96); }
  composer.addPass(P.grade);
  if (o.trans) {
    P.wipe = new ShaderPass(Wipe); P.wipe.uniforms.res.value.set(W, H); P.wipe.enabled = false; composer.addPass(P.wipe);       // off (and free) unless a frame carries `wipe`
    P.trans = new ShaderPass(Trans); P.trans.uniforms.res.value.set(W, H); composer.addPass(P.trans);
  }
  P.composer = composer;
  return P;
}
