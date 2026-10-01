"""Try camera/blocking args on a shot without reloading the page: each view is "label|p|{json args merged into the shot's args}".
   tools/rq.sh python3 -u tools/argtry.py out/slider/t 640 360 b_01 "a|0.97|{}" "b|0.97|{\"cx\":0.1}"
   (normally through tools/views.sh; special JSON keys _sid _tpl _rig _frame: docs/FILM_RUNTIME.md 9.6;
   ZC_QUERY="&aspect=portrait" adds page parameters, e.g. a 9:16 look at a shot at 540x960)
"""
import asyncio, base64, os, sys, time, json
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shoot import serve, CHROME_ARGS

async def main():
    prefix, w, h, sid, *views = sys.argv[1:]
    w, h = int(w), int(h)
    srv = serve(0); port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=CHROME_ARGS)
        pg = await b.new_page(viewport={"width": w, "height": h})
        pg.on("console", lambda m: print("console:", m.text[:300]) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:600]))
        t0 = time.time()
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style=felt&shot=film&w={w}&h={h}&motion=ones&timing=/data/timing.json&shots=/data/shots.json" + os.environ.get("ZC_QUERY", ""))
        await pg.wait_for_function("window.ready===true", timeout=300000)
        err = await pg.evaluate("window.__err || null")
        if err:
            print("BUILD FAILED:", err[:2500]); await b.close(); srv.shutdown(); sys.exit(2)
        print(f"built in {time.time()-t0:.1f}s")
        for n, s in enumerate(views):
            label, pp, js = (s.split('|', 2) + ['{}'])[:3]
            extra = json.loads(js or '{}')
            vsid = extra.pop('_sid', sid)                      # a view may name another shot (its own timing, args and template)
            tpl = extra.pop('_tpl', None)
            rigjs = extra.pop('_rig', None)                    # a JS expression returning a rig {pos, look, fov} (frame, F in scope), e.g. "({pos:[80,9,0.1],look:[80,0,0],fov:60})"
            await pg.evaluate("js => { window.__rigOverride = js ? new Function('frame', 'F', 'return ' + js) : null; }", rigjs)
            framejs = extra.pop('_frame', None)                # JS statements run on the frame before it is posed (frame, F in scope), e.g. "frame.post = { ...frame.post, bloom: 0 }"
            await pg.evaluate("js => { window.__frameOverride = js ? new Function('frame', 'F', js) : null; }", framejs)
            t1 = time.time()
            try:
                r = await pg.evaluate("v => { const sh = window.__film.SH.shots.find(s => s.id === v.sid); if (sh.__args0 === undefined) { sh.__args0 = JSON.parse(JSON.stringify(sh.args || {})); sh.__tpl0 = sh.tpl; } sh.tpl = v.tpl || sh.__tpl0; sh.args = { ...sh.__args0, ...v.extra }; window.setView({ sid: v.sid, p: v.p }); return window.shoot(); }", {"sid": vsid, "p": float(pp), "extra": extra, "tpl": tpl})
            except Exception as e:
                print(f"view {n} '{s}' FAILED: {str(e)[:900]}"); continue
            out = f"{prefix}_{label}.png"
            open(out, "wb").write(base64.b64decode(r.split(",")[1]))
            print(f"[{n}] {label} p={pp} {time.time()-t1:.1f}s -> {out}")
            if os.environ.get('ARMDBG'): print('   ARM:', json.dumps(await pg.evaluate("window.__armDbg || null")))
        info = await pg.evaluate("window.filmInfo()")
        if os.environ.get('CAST'): print('CAST:', json.dumps(info.get('cast')))
        print("WARN:", json.dumps(info['warn'])[:1800])
        await b.close()
    srv.shutdown()
asyncio.run(main())
