"""Render several views of one preview page in a single browser session (the 10 s shader compile is paid once).
   tools/rq.sh python3 -u tools/shootmany.py <out_prefix> <w> <h> "<preview query>" "<view>" ["<view>" ...]

   preview query   what you would pass to shoot.py after 'felt preview', e.g. "p=set&set=atelier&cast=pip@platform,z1@platformL&alive=1"
   view            rig@t[,dur=S][,mode=M][,alive=A][,R=M][,light=EXT][,beat0=B][,args.key=value ...]
                   e.g.  fitWide@0.5   skyRise@0.6,dur=6,args.skylight=1   teaWide@1,mode=tea   mall_door.doorWide@0.5,alive=0,args.door=0.8
   output          <out_prefix>_<n>_<rig>_<t>.png  (n = view number, so files never overwrite each other)
"""
import asyncio, base64, os, sys, time
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__))
from shoot import serve, CHROME_ARGS


def parse_view(s):
    head, *rest = s.split(",")
    rig, _, t = head.partition("@")
    v = {"rig": rig, "t": float(t or 0)}
    args = {}
    for kv in rest:
        k, _, val = kv.partition("=")
        def num(x):
            try: return float(x)
            except ValueError: return x
        if k.startswith("args."): args[k[5:]] = num(val)
        elif k in ("dur", "alive", "R", "beat0"): v[k] = float(val)
        else: v[k] = val
    if args: v["args"] = args
    return v


async def main():
    prefix, w, h, query, *views = sys.argv[1:]
    w, h = int(w), int(h)
    srv = serve(0); port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=CHROME_ARGS)
        pg = await b.new_page(viewport={"width": w, "height": h})
        pg.on("console", lambda m: print("console:", m.text[:300]) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:400]))
        t0 = time.time()
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style=felt&shot=preview&w={w}&h={h}&" + query)
        await pg.wait_for_function("window.ready===true", timeout=240000)
        err = await pg.evaluate("window.__err || null")
        if err:
            print("BUILD FAILED:", err[:1500]); await b.close(); srv.shutdown(); sys.exit(2)
        print(f"built in {time.time()-t0:.1f}s")
        for n, s in enumerate(views):
            v = parse_view(s)
            t1 = time.time()
            try:
                await pg.evaluate("v => window.setView(v)", v)
            except Exception as e:
                print(f"view {n} '{s}' FAILED: {str(e)[:600]}"); continue
            data = await pg.evaluate("window.shoot()")
            out = f"{prefix}_{n}_{v['rig'].replace('.', '-')}_{v['t']:g}.png"
            open(out, "wb").write(base64.b64decode(data.split(",")[1]))
            info = await pg.evaluate("window.info()")
            print(f"[{n}] {s}: {time.time()-t1:.1f}s calls={info['calls']} tris={info['triangles']} -> {out}")
        await b.close()
    srv.shutdown()

asyncio.run(main())
