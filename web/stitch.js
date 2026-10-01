// The "stitch-front": the video's central visual device.
// The mall starts as dead, cold, colourless felt. A front of dashed pink thread spreads outward from the needle;
// everything the front has crossed comes alive. Characters are made over one at a time: the thread climbs the body
// from the hem to the hat, colour returns behind it, and the couture dress is sewn on (fragments appear behind the thread).
import * as THREE from 'three';

// three r170's bump mapping normalises screen-space derivatives (and its result) with plain normalize(): on a grazing pixel one of them can be
// exactly zero, the normal turns NaN, and the bloom blur then spreads that single NaN over a whole band of the frame (sometimes 75% of it).
// Guarded here for every bump-mapped material, before any shader is compiled.
{
  const C = THREE.ShaderChunk, before = C.bumpmap_pars_fragment;
  C.bumpmap_pars_fragment = before
    .replace('vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );', 'vec3 vSigmaX = dFdx( surf_pos.xyz ); float lsx = length( vSigmaX ); vSigmaX = lsx > 1e-30 ? vSigmaX / lsx : vec3( 1.0, 0.0, 0.0 );')
    .replace('vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );', 'vec3 vSigmaY = dFdy( surf_pos.xyz ); float lsy = length( vSigmaY ); vSigmaY = lsy > 1e-30 ? vSigmaY / lsy : vec3( 0.0, 1.0, 0.0 );')
    .replace('return normalize( abs( fDet ) * surf_norm - vGrad );', 'vec3 rr = abs( fDet ) * surf_norm - vGrad; float rl = length( rr ); return rl > 1e-30 ? rr / rl : surf_norm;');
  if (C.bumpmap_pars_fragment === before) console.warn('stitch.js: bump-map NaN guard did not apply (three shader chunk changed?)');
}

export const FRONT = {
  uFront: { value: new THREE.Vector4(0, 0.5, 0, -1) },          // xyz = origin, w = current radius (<0 => nothing stitched yet)
  uFrontWidth: { value: 0.55 },                                   // softness of the colour edge (world units)
  uFrontNoise: { value: 0.55 },                                   // ragged edge amplitude
  uDash: { value: 46 },                                           // dashes around the ring
  uThread: { value: new THREE.Color(1.0, 0.36, 0.66) },           // reserved colour: the pink of the first dress
  uDeadGrade: { value: new THREE.Vector3(0.50, 0.66, 0.95) },     // cold tint of the dead world
  uDeadLift: { value: new THREE.Vector3(0.016, 0.026, 0.052) },   // blue-black floor of the dead world
  uDeadGain: { value: 0.42 },                                     // how bright the dead world is allowed to get
  uDeadKeep: { value: 0.10 },                                     // how much of the original colour survives in the dead state
  uFlicker: { value: 1.0 },                                       // fluorescent flicker on the dead side
  uAlive: { value: 0.0 },                                         // global override: 1 = the whole world alive (final chorus)
  uDeadRim: { value: new THREE.Vector3(0.10, 0.17, 0.34) },      // cold rim light on the dead (grazing angles)
  uFuzz: { value: 0.55 },                                         // felt fibres catching the light at grazing angles
  uMott: { value: 0.16 },                                         // felt mottling amplitude
  uTime: { value: 0.0 },
  uBoil: { value: 0.0 },                                          // stop-motion boil: re-seeds the wool mottling on the puppets from pose to pose (0 = off)
};

const NOISE_GLSL = `
float sc_hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float sc_noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sc_hash(i), sc_hash(i+vec2(1,0)), f.x), mix(sc_hash(i+vec2(0,1)), sc_hash(i+vec2(1,1)), f.x), f.y); }
float sc_h3(vec3 p){ p = fract(p*0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float sc_n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(sc_h3(i+vec3(0,0,0)), sc_h3(i+vec3(1,0,0)), f.x), mix(sc_h3(i+vec3(0,1,0)), sc_h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(sc_h3(i+vec3(0,0,1)), sc_h3(i+vec3(1,0,1)), f.x), mix(sc_h3(i+vec3(0,1,1)), sc_h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
`;

// > 0 once the thread has climbed past this fragment of a character (bottom-up sweep with a ragged edge)
const SEW_FN = `
float sc_sewv(float k, vec3 wp, vec3 op){
  float sh = clamp(wp.y / 2.05, 0.0, 1.0);
  float sn = sc_n3(op * 7.0 + 3.7);
  return k * 1.2 - (0.02 + sh * 0.84 + sn * 0.07);
}`;

// shadow-caster twin for sewn-on parts: an unsewn dress must not cast a shadow
export function sewDepth(K) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.customProgramCacheKey = () => 'sewdepth2';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uK = K;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vOPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vOPos; uniform float uK;\n${NOISE_GLSL}${SEW_FN}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (sc_sewv(uK, vWPos, vOPos) < 0.0) discard;');
  };
  return m;
}

// K   : null for scenery (spatial front) | {value} for a character (bottom-up makeover driven by K.value in 0..1)
// sew : the part only exists once sewn on (dress, shoes, bows); it is discarded ahead of the thread
export function stitchify(mat, K = null, sew = false) {
  const lit = !!mat.isMeshStandardMaterial;
  const isChar = !!K;
  const kObj = K || { value: 0 };
  const holdObj = (kObj.hold ||= { value: 0 });                       // per-character: 1 = stays dead even when the whole world is alive (the shy last zombie)
  mat.userData.uK = kObj; mat.userData.sew = sew;
  mat.customProgramCacheKey = () => 'stitch2' + (isChar ? 'C' : 'W') + (sew ? 'S' : '') + (lit ? 'L' : 'B');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FRONT, { uK: kObj, uHold: holdObj });
    const defs = (isChar ? '#define SC_CHAR\n' : '') + (sew ? '#define SC_SEW\n' : '') + (lit ? '#define SC_LIT\n' : '');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vOPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vOPos = transformed;
        vec4 scWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          scWp = instanceMatrix * scWp;
        #endif
        vWPos = (modelMatrix * scWp).xyz;`);
    shader.fragmentShader = defs + shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vOPos;
        uniform vec4 uFront; uniform float uFrontWidth, uFrontNoise, uDash, uDeadKeep, uDeadGain, uFlicker, uAlive, uK, uFuzz, uMott, uTime, uBoil, uHold; uniform vec3 uThread, uDeadGrade, uDeadLift, uDeadRim;
        ${NOISE_GLSL}${SEW_FN}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float scSv = 1.0;
        #ifdef SC_CHAR
          scSv = sc_sewv(uK, vWPos, vOPos);
          #ifdef SC_SEW
            if (scSv < 0.0) discard;
          #endif
        #endif`)
      .replace('#include <opaque_fragment>', `
        {
          float fz = 0.0;
          #ifdef SC_LIT
            #ifdef SC_CHAR
              fz = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
              outgoingLight += diffuseColor.rgb * fz * uFuzz;
            #endif
            #ifdef SC_CHAR
              float scBo = uBoil;
            #else
              float scBo = 0.0;
            #endif
            outgoingLight *= 1.0 - uMott * 0.5 + uMott * sc_n3(vOPos * 46.0 + scBo);
          #endif
          float k, edge = 0.0, band = 0.0, glowb = 0.0, dash = 1.0;
          #ifdef SC_CHAR
            k = max(smoothstep(0.0, 0.18, scSv), uAlive * (1.0 - uHold));
            edge = scSv - 0.02;
            float ang = atan(vOPos.z, vOPos.x);
            dash = step(0.40, fract(ang * 1.5915 + sc_n3(vOPos * 3.0) * 0.4));
            float live = (uK > 0.001 && uK < 0.999 && uAlive < 0.5) ? 1.0 : 0.0;
            band = (1.0 - smoothstep(0.012, 0.042, abs(edge))) * live;
            glowb = (1.0 - smoothstep(0.0, 0.30, abs(edge))) * 0.22 * live;
          #else
            vec2 dv = vWPos.xz - uFront.xz;
            float dd = length(vec3(dv.x, (vWPos.y - uFront.y) * 0.35, dv.y));
            float rag = (sc_noise(vWPos.xz * 0.55 + vWPos.y * 0.3) - 0.5) * uFrontNoise + (sc_noise(vWPos.xz * 2.3) - 0.5) * uFrontNoise * 0.3;
            edge = uFront.w + rag - dd;                                // > 0 : behind the needle (stitched)
            float kF = uFront.w < 0.0 ? 0.0 : smoothstep(-uFrontWidth, uFrontWidth * 0.1, edge);
            k = max(max(kF, uK), uAlive);
            if (uFront.w >= 0.0 && uAlive < 0.5) {
              float ang = atan(dv.y, dv.x);
              dash = step(0.38, fract(ang * uDash / 6.2831853));
              band = 1.0 - smoothstep(0.05, 0.13, abs(edge - 0.03));
              glowb = (1.0 - smoothstep(0.0, 0.55, abs(edge - 0.03))) * 0.22;
            }
          #endif
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          float lumD = lum / (1.0 + 0.85 * lum);          // soft shoulder: a hot spotlight must not turn the dead floor white
          vec3 dead = (uDeadLift + pow(max(lumD, 0.0), 1.1) * uDeadGain * 1.9 * uDeadGrade + (outgoingLight - vec3(lum)) * uDeadKeep * uDeadGain) * uFlicker;
          dead += uDeadRim * fz * uFlicker;
          outgoingLight = mix(dead, outgoingLight, k);
          outgoingLight = mix(outgoingLight, uThread * 1.15, band * dash * 0.95);
          outgoingLight += uThread * glowb;
        }
        #include <opaque_fragment>`);
  };
  mat.needsUpdate = true;
  return mat;
}
