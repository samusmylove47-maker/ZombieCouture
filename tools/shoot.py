"""Render still frames from the three.js world with headless Chromium (software WebGL).
   python3 tools/shoot.py <style> <shot> <out.png> [w h]      style: vinyl|felt   shot: hero|low|cctv
"""
import asyncio, base64, functools, http.server, os, socketserver, sys, threading, time
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class _Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True


def serve(port=0):
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", port), _Q)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


CHROME_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync"]


async def shoot(style, shot, out, w=1280, h=720, port=0, extra=""):
    srv = serve(port)
    port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=CHROME_ARGS)
        pg = await b.new_page(viewport={"width": w, "height": h})
        pg.on("console", lambda m: print("console:", m.text[:300]) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:400]))
        t0 = time.time()
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style={style}&shot={shot}&w={w}&h={h}" + ("&" + extra if extra else ""))
        await pg.wait_for_function("window.ready===true", timeout=180000)
        t1 = time.time()
        err = await pg.evaluate("window.__err || null")
        if err:
            print("BUILD FAILED:", err[:1500]); await b.close(); srv.shutdown(); sys.exit(2)
        data = await pg.evaluate("window.shoot()")
        t2 = time.time()
        open(out, "wb").write(base64.b64decode(data.split(",")[1]))
        info = await pg.evaluate("window.info()")
        print(f"{style}/{shot}: build {t1-t0:.1f}s  render {t2-t1:.1f}s  calls={info['calls']} tris={info['triangles']}  -> {out}")
        await b.close()
    srv.shutdown()


if __name__ == "__main__":
    style, shot, out = sys.argv[1:4]
    w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (1280, 720)
    extra = sys.argv[6] if len(sys.argv) > 6 else ""
    asyncio.run(shoot(style, shot, out, w, h, 0, extra))
