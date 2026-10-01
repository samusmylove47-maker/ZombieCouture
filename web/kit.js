// The shared light kit.  Every shot of the film is lit by the same ten lights (1 directional with the only shadow map, 1 hemisphere,
// 6 spots, 2 points), so three.js never has to recompile a material when the cut changes: a shot only moves the lights and sets intensities.
// Sets must NOT create their own lights.  They describe their lighting by calling the setters below from their light(kit, u, ctx) function.
import * as THREE from 'three';

export function makeKit(scene, opt = {}) {
  const nSpot = opt.spots ?? 6, nPoint = opt.points ?? 2, map = opt.shadow ?? 2048;
  const key = new THREE.DirectionalLight(0xffffff, 0);
  key.castShadow = true; key.shadow.mapSize.set(map, map);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0); scene.add(hemi);
  const spots = [], points = [];
  for (let i = 0; i < nSpot; i++) { const s = new THREE.SpotLight(0xffffff, 0, 30, 0.7, 0.6, 1.2); scene.add(s, s.target); spots.push(s); }
  for (let i = 0; i < nPoint; i++) { const p = new THREE.PointLight(0xffffff, 0, 8, 1.5); scene.add(p); points.push(p); }
  const C = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));
  const kit = {
    key, hemi, spots, points, nSpot, nPoint,
    // silence everything (call first in every light() function so a shot never inherits the previous shot's lights)
    off() { key.intensity = 0; hemi.intensity = 0; spots.forEach((s) => (s.intensity = 0)); points.forEach((p) => (p.intensity = 0)); return kit; },
    // sun / key light: the ONLY light that casts shadows.  extent = half-size (m) of the shadow box around `target`; keep it as small as the shot allows.
    setKey(o) {
      key.position.set(...o.pos); key.target.position.set(...(o.target ?? [0, 0, 0])); key.color.copy(C(o.color ?? 0xffffff)); key.intensity = o.i ?? 1;
      const e = o.extent ?? 13, cam = key.shadow.camera;
      cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = o.near ?? 1; cam.far = o.far ?? 36; cam.updateProjectionMatrix();
      key.shadow.bias = o.bias ?? -0.0004; key.shadow.normalBias = o.normalBias ?? 0.03; key.shadow.radius = o.radius ?? 4;
      key.castShadow = o.shadow !== false; return kit;
    },
    setHemi(o) { hemi.color.copy(C(o.sky ?? 0xffffff)); hemi.groundColor.copy(C(o.ground ?? 0x888888)); hemi.intensity = o.i ?? 0.5; return kit; },
    setSpot(n, o) {
      const s = spots[n]; if (!s) return kit;
      s.color.copy(C(o.color ?? 0xffffff)); s.intensity = o.i ?? 0; s.distance = o.dist ?? 30; s.angle = o.angle ?? 0.7; s.penumbra = o.pen ?? 0.6; s.decay = o.decay ?? 1.2;
      s.position.set(...o.pos); s.target.position.set(...(o.target ?? [0, 0, 0])); return kit;
    },
    setPoint(n, o) {
      const p = points[n]; if (!p) return kit;
      p.color.copy(C(o.color ?? 0xffffff)); p.intensity = o.i ?? 0; p.distance = o.dist ?? 8; p.decay = o.decay ?? 1.5; p.position.set(...o.pos); return kit;
    },
  };
  return kit;
}
