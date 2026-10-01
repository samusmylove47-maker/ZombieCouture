"""Steady-state render timing:  python3 tools/bench.py <style> <shot> <w> <h> [n]"""
import asyncio, sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from shoot import serve, CHROME_ARGS
from playwright.async_api import async_playwright
async def main(style, shot, w, h, n, extra=""):
    srv = serve(); port = srv.server_address[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=CHROME_ARGS); pg = await b.new_page(viewport={"width": w, "height": h})
        await pg.goto(f"http://127.0.0.1:{port}/web/index.html?style={style}&shot={shot}&w={w}&h={h}{extra}")
        await pg.wait_for_function("window.ready===true", timeout=180000)
        ts = []
        for i in range(n):
            t = time.time(); await pg.evaluate("window.shoot().length"); ts.append(time.time() - t)
        print(f"{style} {shot} {w}x{h} {extra}: first {ts[0]:.1f}s, steady {sum(ts[1:])/max(1,len(ts)-1):.2f}s/frame  ({[round(x,1) for x in ts]})")
        await b.close()
    srv.shutdown()
style, shot, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); n = int(sys.argv[5]) if len(sys.argv) > 5 else 4
asyncio.run(main(style, shot, w, h, n, sys.argv[6] if len(sys.argv) > 6 else ''))
