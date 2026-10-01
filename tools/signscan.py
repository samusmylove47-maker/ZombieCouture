#!/usr/bin/env python3
"""Which film frames show a neon sign, where and how big (no rendering: setT only, so it takes seconds).

  python3 tools/signscan.py [--w 1920 --h 1080] [--from 0 --to 4248] [--skip 2703:2795] [--q "aspect=portrait&short=/data/short.json"] [--out out/signscan.json]

Output: a list of [frame, [[sign, x0, y0, x1, y1, area_px, cos_view_angle, distance_m, corners_behind_camera, [[x, y] x4]], ...]].
Use it after a root-cause fix that touches the signs (web/set.js) to list the frames that must be rendered again; --skip leaves out the slider
shot, whose setT renders a second picture and is slow.  The signs are the PlaneGeometry(4.2 x 1.05) meshes of web/set.js.
"""
import argparse, asyncio, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shoot as S
from playwright.async_api import async_playwright

JS_INIT = """() => {
  const F = window.__film, pass = F.post.composer.passes[0], cam = pass.camera, scene = pass.scene;
  const signs = [];
  scene.traverse(o => { if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters && Math.abs(o.geometry.parameters.width - 4.2) < 1e-6 && Math.abs(o.geometry.parameters.height - 1.05) < 1e-6) signs.push(o); });
  window.__signs = signs; window.__cam = cam;
  return signs.length;
}"""
JS_RUN = """([a, b, W, H]) => {
  const cam = window.__cam, signs = window.__signs, V3 = cam.position.constructor;
  const res = [];
  for (let n = a; n < b; n++) {
    window.setT(n / 24);
    cam.updateMatrixWorld(true);
    const row = [];
    signs.forEach((m, i) => {
      let o = m, vis = true; while (o) { if (!o.visible) vis = false; o = o.parent; }
      if (!vis) return;
      m.updateWorldMatrix(true, false);
      const pts = []; let behind = 0;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = new V3(sx * 2.1, sy * 0.525, 0).applyMatrix4(m.matrixWorld);
        const c = p.clone().applyMatrix4(cam.matrixWorldInverse);
        if (c.z > -0.06) { behind++; continue; }
        p.applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
        pts.push([(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H]);
      }
      if (pts.length < 3) return;
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
      if (x1 <= x0 || y1 <= y0) return;
      let A = 0; for (let k = 0; k < pts.length; k++) { const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length]; A += ax * by - bx * ay; } A = Math.abs(A) / 2;
      const wc = new V3(); m.getWorldPosition(wc);
      const toCam = cam.position.clone().sub(wc); const d = toCam.length(); toCam.normalize();
      row.push([i, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), Math.round(Math.min(A, (x1 - x0) * (y1 - y0))), +toCam.z.toFixed(3), +d.toFixed(1), behind, pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])]);
    });
    res.push([n, row]);
  }
  return res;
}"""


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--w", type=int, default=1920)
    ap.add_argument("--h", type=int, default=1080)
    ap.add_argument("--from", dest="n0", type=int, default=0)
    ap.add_argument("--to", dest="n1", type=int, default=4248)
    ap.add_argument("--skip", default="", help="a:b frame range to leave out (repeat with commas)")
    ap.add_argument("--q", default="", help="extra page query")
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--out", default=os.path.join(S.ROOT, "out", "signscan.json"))
    a = ap.parse_args()
    skips = [tuple(int(v) for v in s.split(":")) for s in a.skip.split(",") if s]
    spans, cur = [], a.n0
    for s0, s1 in sorted(skips) + [(a.n1, a.n1)]:
        if s0 > cur:
            spans.append((cur, min(s0, a.n1)))
        cur = max(cur, s1)
    srv = S.serve(0); port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=S.CHROME_ARGS)
        pg = await b.new_page(viewport={"width": a.w, "height": a.h})
        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:400]))
        t0 = time.time()
        q = "motion=ones&hand=1&timing=/data/timing.json&shots=/data/shots.json" + ("&" + a.q if a.q else "")
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style=felt&shot=film&w={a.w}&h={a.h}&t=0&{q}")
        await pg.wait_for_function("window.ready===true", timeout=300000)
        print("built", round(time.time() - t0, 1), "s")
        print("sign meshes:", await pg.evaluate(JS_INIT))
        out = []
        for s0, s1 in spans:
            for x in range(s0, s1, a.batch):
                out += await pg.evaluate(JS_RUN, [x, min(x + a.batch, s1), a.w, a.h])
                print(x, round(time.time() - t0, 1), flush=True)
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(out, open(a.out, "w"))
        seen = sum(1 for _, row in out if row)
        print(f"{len(out)} frames scanned, {seen} show at least one sign; wrote {a.out}")
        await b.close()
    srv.shutdown()

asyncio.run(main())
