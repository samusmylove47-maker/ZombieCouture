#!/usr/bin/env python3
"""Static audit for depth fighting (z-fighting): pairs of triangles from DIFFERENT meshes that lie in the same plane and overlap.

  python3 tools/zfight_audit.py [--tol 0.005] [--out out/zfight.json] [--q "extra&query"]

Every set of the film is made visible, the characters are hidden, and all static triangles are bucketed by plane (normal and offset, cells of --tol
metres).  Two triangles of different meshes in one bucket whose footprints overlap are reported with both meshes described (set, geometry, material,
colour, polygon offset).  Faces that point the same way and share a material are harmless; what matters are different colours or materials on the
same plane (a sign plane lying on a wall, a decal laid on a floor).  Depth precision at 20 m is about half a millimetre and at 100 m about a
centimetre, so a gap of a few millimetres still fights in distant shots.  Found this way on 2026-09-30: the neon sign planes lay exactly on the wall's
front face (fixed with a polygon offset in web/set.js).  Pair it with tools/signscan.py (which frames show a given mesh) and re-render those frames.
"""
import argparse, asyncio, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shoot as S
from playwright.async_api import async_playwright

JS = """(TOL) => {
  const F = window.__film, pass = F.post.composer.passes[0], scene = pass.scene;
  const sets = {...F.S, ...F.EXT};
  const roots = Object.entries(sets).map(([k, s]) => [k, s.root]).filter(([k, r]) => r);
  const charObjs = new Set(Object.values(F.CHARS).map(c => c.obj));
  roots.forEach(([k, r]) => { r.visible = true; });
  Object.values(F.CHARS).forEach(c => { c.obj.visible = false; });
  scene.updateMatrixWorld(true);
  const V3 = pass.camera.position.constructor;
  const meshes = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry || o.isSkinnedMesh || o.isInstancedMesh) return;
    let a = o, skip = false, setName = null;
    while (a) { if (charObjs.has(a)) skip = true; for (const [k, r] of roots) if (a === r && !setName) setName = k; a = a.parent; }
    if (skip) return;
    const pos = o.geometry.attributes.position; if (!pos) return;
    meshes.push({ o, setName });
  });
  const desc = (m) => {
    const o = m.o, g = o.geometry, p = g.parameters || {};
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const bb = (g.boundingBox || (g.computeBoundingBox(), g.boundingBox)).clone().applyMatrix4(o.matrixWorld);
    return { set: m.setName, geo: g.type + (p.width ? `(${p.width}x${p.height}${p.depth ? 'x' + p.depth : ''})` : ''), mat: mat && mat.type, col: mat && mat.color ? mat.color.getHexString() : null,
             po: mat && mat.polygonOffset ? [mat.polygonOffsetFactor, mat.polygonOffsetUnits] : null, vis: o.visible,
             c: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(v => +v.toFixed(2)) };
  };
  // triangles in world space, bucketed by plane
  const buckets = new Map();
  const tri = new V3(), a = new V3(), b = new V3(), c = new V3(), n = new V3(), e1 = new V3(), e2 = new V3();
  meshes.forEach((m, mi) => {
    const g = m.o.geometry, pos = g.attributes.position, idx = g.index; const W = m.o.matrixWorld;
    const nt = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(W); b.fromBufferAttribute(pos, i1).applyMatrix4(W); c.fromBufferAttribute(pos, i2).applyMatrix4(W);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); const area = n.length() / 2; if (area < 1e-5) continue;
      n.normalize();
      // canonical sign: the largest component positive
      let s = 1; const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const big = ax >= ay && ax >= az ? n.x : ay >= az ? n.y : n.z; if (big < 0) s = -1;
      const nx = n.x * s, ny = n.y * s, nz = n.z * s, d = (nx * a.x + ny * a.y + nz * a.z);
      const kq = (v) => Math.round(v * 400);
      const dq = Math.floor(d / TOL);
      for (const dd of [dq, dq + 1]) {                 // a pair split by a cell boundary is still found
        const key = kq(nx) + ',' + kq(ny) + ',' + kq(nz) + ',' + dd;
        let arr = buckets.get(key); if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push([mi, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, nx, ny, nz, d, area]);
        if (dd === dq && ((d / TOL) - dq) > 0.2 && ((d / TOL) - dq) < 0.8) break;
      }
    }
  });
  // overlap test in the plane: project to 2D with a basis, SAT on triangles, shrink slightly
  const res = new Map();
  const proj = (t, ux, uy, uz, vx, vy, vz) => [[t[1] * ux + t[2] * uy + t[3] * uz, t[1] * vx + t[2] * vy + t[3] * vz], [t[4] * ux + t[5] * uy + t[6] * uz, t[4] * vx + t[5] * vy + t[6] * vz], [t[7] * ux + t[8] * uy + t[9] * uz, t[7] * vx + t[8] * vy + t[9] * vz]];
  const sat = (P, Q) => {
    const sh = (T) => { const cx = (T[0][0] + T[1][0] + T[2][0]) / 3, cy = (T[0][1] + T[1][1] + T[2][1]) / 3; return T.map(p => [cx + (p[0] - cx) * 0.98, cy + (p[1] - cy) * 0.98]); };
    P = sh(P); Q = sh(Q);
    for (const T of [P, Q]) for (let i = 0; i < 3; i++) {
      const p0 = T[i], p1 = T[(i + 1) % 3]; const ex = p1[0] - p0[0], ey = p1[1] - p0[1]; const ax_ = -ey, ay_ = ex;
      let mn1 = 1e30, mx1 = -1e30, mn2 = 1e30, mx2 = -1e30;
      for (const p of P) { const v = p[0] * ax_ + p[1] * ay_; mn1 = Math.min(mn1, v); mx1 = Math.max(mx1, v); }
      for (const p of Q) { const v = p[0] * ax_ + p[1] * ay_; mn2 = Math.min(mn2, v); mx2 = Math.max(mx2, v); }
      if (mx1 <= mn2 || mx2 <= mn1) return false;
    }
    return true;
  };
  let checked = 0;
  for (const [key, arr] of buckets) {
    if (arr.length < 2) continue;
    const mset = new Set(arr.map(r => r[0])); if (mset.size < 2) continue;
    // basis
    const r0 = arr[0]; const nx = r0[10], ny = r0[11], nz = r0[12];
    let ux, uy, uz; if (Math.abs(nx) < 0.9) { ux = 0; uy = -nz; uz = ny; } else { ux = nz; uy = 0; uz = -nx; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const P2 = arr.map(r => proj(r, ux, uy, uz, vx, vy, vz));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (arr[i][0] === arr[j][0]) continue;
      if (Math.abs(arr[i][13] - arr[j][13]) > TOL) continue;
      // bbox reject
      const A = P2[i], B = P2[j];
      const aminx = Math.min(A[0][0], A[1][0], A[2][0]), amaxx = Math.max(A[0][0], A[1][0], A[2][0]), aminy = Math.min(A[0][1], A[1][1], A[2][1]), amaxy = Math.max(A[0][1], A[1][1], A[2][1]);
      const bminx = Math.min(B[0][0], B[1][0], B[2][0]), bmaxx = Math.max(B[0][0], B[1][0], B[2][0]), bminy = Math.min(B[0][1], B[1][1], B[2][1]), bmaxy = Math.max(B[0][1], B[1][1], B[2][1]);
      if (amaxx <= bminx || bmaxx <= aminx || amaxy <= bminy || bmaxy <= aminy) continue;
      checked++;
      if (!sat(A, B)) continue;
      const k2 = Math.min(arr[i][0], arr[j][0]) + '|' + Math.max(arr[i][0], arr[j][0]);
      let r = res.get(k2); if (!r) { r = { a: Math.min(arr[i][0], arr[j][0]), b: Math.max(arr[i][0], arr[j][0]), n: [+nx.toFixed(3), +ny.toFixed(3), +nz.toFixed(3)], d: +arr[i][13].toFixed(4), dd: 0, tris: 0, area: 0, at: [arr[i][1], arr[i][2], arr[i][3]].map(v => +v.toFixed(2)) }; res.set(k2, r); }
      r.tris++; r.area += Math.min(arr[i][14], arr[j][14]); r.dd = Math.max(r.dd, Math.abs(arr[i][13] - arr[j][13]));
    }
  }
  const out = [...res.values()].map(r => ({ ...r, area: +r.area.toFixed(3), dd: +r.dd.toFixed(5), A: desc(meshes[r.a]), B: desc(meshes[r.b]) }));
  return { meshes: meshes.length, tris: [...buckets.values()].reduce((s, a) => s + a.length, 0), checked, pairs: out };
}"""


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tol", type=float, default=0.005, help="plane cell size in metres")
    ap.add_argument("--out", default=os.path.join(S.ROOT, "out", "zfight.json"))
    ap.add_argument("--q", default="", help="extra page query")
    a = ap.parse_args()
    srv = S.serve(0); port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=S.CHROME_ARGS)
        pg = await b.new_page(viewport={"width": 640, "height": 360})
        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:400]))
        t0 = time.time()
        q = "motion=ones&hand=1&timing=/data/timing.json&shots=/data/shots.json" + ("&" + a.q if a.q else "")
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style=felt&shot=film&w=640&h=360&t=0&{q}")
        await pg.wait_for_function("window.ready===true", timeout=300000)
        print("built", round(time.time() - t0, 1), "s", flush=True)
        r = await pg.evaluate(JS, a.tol)
        print("meshes", r["meshes"], "triangles", r["tris"], "pair tests", r["checked"], "overlapping pairs", len(r["pairs"]))
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(r, open(a.out, "w"), indent=1)
        def short(d):
            return f"{d['set']}:{d['geo']}:{d['mat']}:{d['col']}" + (f":offset{d['po']}" if d['po'] else "")
        diff = [x for x in r["pairs"] if (x["A"]["col"] != x["B"]["col"] or x["A"]["mat"] != x["B"]["mat"]) and x["area"] >= 0.01]
        diff.sort(key=lambda x: -x["area"])
        print(f"{len(diff)} pairs with different colour or material (area in m2, gap in m):")
        for x in diff[:40]:
            print(f"  {x['area']:8.3f}  gap {x['dd']:.4f}  {short(x['A'])}  <>  {short(x['B'])}")
        print("wrote", a.out)
        await b.close()
    srv.shutdown()

asyncio.run(main())
