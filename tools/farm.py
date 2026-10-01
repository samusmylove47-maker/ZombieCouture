#!/usr/bin/env python3
"""Frame farm: renders frames of a scene (story, film) in headless Chromium. Resumable, shardable, crash-proof.

  python3 tools/farm.py --scene film --w 1280 --h 720 --on 2 --fmt jpg --jpgq 0.92 \
      --q "motion=twos&hand=1&timing=/data/timing.json&shots=/data/shots.json" --out out/frames/review
  (normally started through tools/render_all.sh review|master|short|thumb)

Old CLI still works:  --scene story --t0 0 --t1 9 --fps 24 --on 2 --w 960 --h 540 --out DIR [--shard 0/2] [--fmt jpg] [--q "k=v"] [--limit N]

Frame numbering: file f_%05d is the ABSOLUTE frame number round(t*fps) (--rel restores the old numbering from --t0).
A frame is a pure function of its time, so reruns, shards and partial re-renders are interchangeable.

What it does for a long render:
  * a supervisor (this process) starts --procs worker processes (--shard k/N, reniced, own process group);
    a worker that dies, or shows no frame progress for --hard-timeout s, is killed (whole group) and restarted; it resumes.
  * inside a worker: per-frame timeout (--timeout 180) with --retries 3 (retry, then recreate the browser), browser recycled every
    --recycle 300 frames or when memory is low, atomic writes (*.tmp then rename), skip test that checks JPEG/PNG markers and size
    (--verify decodes fully), progress.json every 10 frames, SIGTERM/SIGINT finish the current frame and exit cleanly (143).
  * a frame that still fails after all retries is logged and skipped; the run continues, a second pass retries the missing ones
    (--passes), and the exit code is non-zero if any frame is missing at the end (missing.txt lists them).
  * "on N": only every Nth frame (and the first frame of every shot/window) is rendered; --fill-only copies the previous rendered frame
    into the gaps (runs automatically at the end of a supervised run).

Selecting frames:  --t0/--t1 | --range a:b | --only shot_or_section_id,... --shots data/shots.json (frames of those shots only)
Other modes:       --plan (print the plan) | --fill-only | --status | --lock-status
Exit codes: 0 complete, 1 frames missing, 2 setup/build failure, 3 systematic failure, 75 another farm holds the directory, 143 terminated (rerun to resume)
Test hook ZC_FARM_FAKE=<seconds per frame>: no browser, every frame is a generated picture (tests the supervision, resume and fill logic without load).
Test hooks (env ZC_FARM_INJECT="kind:frame:count,..."): fail (exception), hang (soft timeout), crash (kills the browser), exit (worker dies once), hardhang (blocks the loop once).
"""
import argparse, asyncio, base64, fcntl, glob, io, json, math, os, re, shutil, signal, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

DEFAULT_PROCS = 1          # 1 vs 2 workers has not been measured on a quiet machine (load was 5 to 8); earlier tests showed no gain from 2 on 2 cores
FAKE_S = os.environ.get("ZC_FARM_FAKE")   # test hook: no browser at all; every frame is a generated picture that takes this many seconds
DEFAULT_TAIL = 4.0         # seconds after the song when neither shots.json nor storyboard.json says otherwise

INIT_JS = """(() => {
  const Q = __JPEGQ__;
  window.__ctxLost = false;
  window.addEventListener('webglcontextlost', () => { window.__ctxLost = true; }, true);
  if (Q !== null) {
    const td = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) { return td.call(this, type, type === 'image/jpeg' ? Q : quality); };
    const tb = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, type, quality) { return tb.call(this, cb, type, type === 'image/jpeg' ? Q : quality); };
  }
})();"""

JS_FRAME = """async ([t, fmt]) => {
  const r = window.setT(t); if (r && typeof r.then === 'function') await r;
  const d = await window.shoot(fmt);
  if (window.__ctxLost) throw new Error('webgl context lost');
  if (typeof d !== 'string' || d.indexOf('data:image/') !== 0) throw new Error('shoot() did not return a data URL');
  return d;
}"""

# --------------------------------------------------------------------------------------------- small helpers
T_START = time.time()


def log(msg, tag=""):
    print(f"{time.strftime('%H:%M:%S')} {tag}{msg}", flush=True)


def parse_shard(s):
    k, n = map(int, s.split("/"))
    if not (0 <= k < n):
        raise SystemExit(f"bad --shard {s}")
    return k, n


def write_json_atomic(path, obj):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def fmt_hms(sec):
    if sec is None or sec != sec or sec < 0:
        return "?"
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def mem_available_mb():
    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except Exception:
        pass
    return 10 ** 9


def descendants(pid):
    """All descendant pids of pid (from /proc, no psutil needed)."""
    kids = {}
    for p in glob.glob("/proc/[0-9]*/stat"):
        try:
            s = open(p).read()
            rest = s[s.rindex(")") + 2:].split()
            kids.setdefault(int(rest[1]), []).append(int(s.split()[0]))
        except Exception:
            pass
    out, stack = [], [pid]
    while stack:
        for c in kids.get(stack.pop(), []):
            out.append(c)
            stack.append(c)
    return out


def kill_descendants(pid=None):
    for c in descendants(pid or os.getpid()):
        try:
            os.kill(c, signal.SIGKILL)
        except OSError:
            pass


def q_get(q, key):
    m = re.search(r"(?:^|&)" + re.escape(key) + r"=([^&]*)", q or "")
    return m.group(1) if m else None


def url_to_path(u):
    if not u or "://" in u:
        return None
    p = os.path.join(ROOT, u.lstrip("/"))
    return p if os.path.exists(p) else None


# --------------------------------------------------------------------------------------------- frame files
def frame_ok(path, w=None, h=None, verify=False):
    """True if path is a complete JPEG/PNG of the expected size (markers at both ends; with verify, a full decode)."""
    try:
        size = os.path.getsize(path)
        if size < 1000:
            return False
        with open(path, "rb") as f:
            head = f.read(8)
            f.seek(-12, 2)
            tail = f.read(12)
    except OSError:
        return False
    ext = path.rsplit(".", 1)[-1].lower()
    if ext in ("jpg", "jpeg"):
        if head[:3] != b"\xff\xd8\xff" or b"\xff\xd9" not in tail[-4:]:
            return False
    elif ext == "png":
        if head != b"\x89PNG\r\n\x1a\n" or tail != b"\x00\x00\x00\x00IEND\xaeB`\x82":
            return False
    if w or verify:
        try:
            from PIL import Image
            with Image.open(path) as im:
                if w and (im.size != (w, h)):
                    return False
                if verify:
                    im.load()
        except Exception:
            return False
    return True


# --------------------------------------------------------------------------------------------- plan
class Plan:
    def __init__(self, a):
        self.a = a
        self.fps = a.fps
        self.on = max(1, a.on)
        self.ext = "jpg" if a.fmt in ("jpg", "jpeg") else a.fmt
        self.shots = []
        sp = a.shots or url_to_path(q_get(a.q, "shots"))
        if sp and os.path.exists(sp):
            d = read_json(sp, {})
            self.shots = [s for s in (d.get("shots", []) if isinstance(d, dict) else d) if "t0" in s and "t1" in s]
        windows = self._windows()
        frames, starts = set(), set()
        for t0, t1 in windows:
            i0, i1 = math.ceil(t0 * self.fps - 1e-6), math.ceil(t1 * self.fps - 1e-6)
            if i1 > i0:
                starts.add(i0)
                frames.update(range(i0, i1))
        shot_starts = {math.ceil(s["t0"] * self.fps - 1e-6) for s in self.shots}
        self.frames = sorted(frames)
        # on N: every Nth frame, plus the first frame of every window and of every shot (a cut on an odd frame must show the new shot)
        self.render = [i for i in self.frames if i % self.on == 0 or i in starts or i in shot_starts]
        self._rset = set(self.render)
        self.offset = (self.frames[0] if self.frames else 0) if a.rel else 0
        self.windows = windows

    def _windows(self):
        a = self.a
        if a.only:
            if not self.shots:
                raise SystemExit("--only needs --shots data/shots.json (or shots=... in --q)")
            want, out = [x.strip() for x in a.only.split(",") if x.strip()], []
            ids = sorted(s["id"] for s in self.shots)
            secs = {s.get("section") for s in self.shots}
            for w in want:
                hit = [s for s in self.shots if s["id"] == w] or ([s for s in self.shots if s.get("section") == w] if w in secs else [])
                if not hit:
                    raise SystemExit(f"--only: unknown shot or section '{w}'. Shots: {', '.join(ids[:40])} ...")
                out += [(s["t0"], s["t1"]) for s in hit]
            return out
        if a.range:
            t0, t1 = a.range.split(":")
            return [(float(t0), float(t1))]
        t1 = a.t1 if a.t1 is not None else self.default_t1()
        return [(a.t0, t1)]

    def default_t1(self):
        a = self.a
        if self.shots:
            return max(s["t1"] for s in self.shots)
        if a.scene == "film":
            tp = url_to_path(q_get(a.q, "timing")) or os.path.join(ROOT, "data", "timing.json")
            T = read_json(tp)
            if T:
                tail = (read_json(os.path.join(ROOT, "data", "storyboard.json"), {}) or {}).get("tail", DEFAULT_TAIL)
                return T["meta"]["duration"] + tail
            raise SystemExit("film scene: give --t1, or --shots data/shots.json, or make data/timing.json first")
        return 9.0

    def path(self, i):
        return os.path.join(self.a.out, f"f_{i - self.offset:05d}.{self.ext}")

    def t_of(self, i):
        return i / self.fps

    def is_rendered(self, i):
        return i in self._rset

    def base_of(self, i):
        """The rendered frame that gap frame i repeats (the closest earlier one in the plan)."""
        r = self.render
        lo, hi = 0, len(r)
        while lo < hi:
            m = (lo + hi) // 2
            if r[m] <= i:
                lo = m + 1
            else:
                hi = m
        return r[lo - 1] if lo else None

    def shard_frames(self, k, n):
        return [i for i in self.render if (i // self.on) % n == k]


def missing_frames(plan, verify=False):
    a = plan.a
    return [i for i in plan.frames if not frame_ok(plan.path(i), a.w, a.h, verify)]


def missing_rendered(plan):
    a = plan.a
    return [i for i in plan.render if not frame_ok(plan.path(i), a.w, a.h)]


def same_content(src, dst):
    try:
        if os.path.samefile(src, dst):
            return True
        if os.path.getsize(src) != os.path.getsize(dst):
            return False
        with open(src, "rb") as f, open(dst, "rb") as g:
            return f.read() == g.read()
    except OSError:
        return False


def fill_gaps(plan, link=False):
    """Copy (or hard-link) each rendered frame into the frames after it, up to the next rendered one."""
    a = plan.a
    filled, missing_base = 0, []
    for i in plan.frames:
        if plan.is_rendered(i):
            continue
        b = plan.base_of(i)
        if b is None or not frame_ok(plan.path(b), a.w, a.h):
            missing_base.append(i)
            continue
        src, dst = plan.path(b), plan.path(i)
        if os.path.exists(dst) and same_content(src, dst) and frame_ok(dst, a.w, a.h):
            continue
        tmp = f"{dst}.{os.getpid()}.tmp"
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
            if link:
                os.link(src, tmp)
            else:
                shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
            filled += 1
        except OSError as e:
            log(f"fill {i}: {e}")
            missing_base.append(i)
    return filled, missing_base


# --------------------------------------------------------------------------------------------- locks
def acquire_lock(out, k, n):
    """Exclusive lock for this shard spec; refuses when another farm holds the directory. Returns (fd, None) or (None, why)."""
    os.makedirs(out, exist_ok=True)
    mine = os.path.join(out, f".farm.{k}-{n}.lock")
    fd = os.open(mine, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return None, f"a farm with shard {k}/{n} already runs in {out}: {open(mine).read().strip()}"
    why = lock_conflict(out, mine, n)
    if why:
        os.close(fd)
        return None, why
    os.ftruncate(fd, 0)
    os.write(fd, f"pid {os.getpid()} shard {k}/{n} started {time.strftime('%F %T')}\n".encode())
    return fd, None


def lock_conflict(out, mine, n):
    for p in glob.glob(os.path.join(out, ".farm.*.lock")):
        if p == mine:
            continue
        m = re.search(r"\.farm\.(\d+)-(\d+)\.lock$", p)
        if not m or int(m.group(2)) == n:
            continue
        fd = os.open(p, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
        except BlockingIOError:
            return f"another farm (shard {m.group(1)}/{m.group(2)}) holds {out}: {open(p).read().strip()}"
        finally:
            os.close(fd)
    return None


def lock_holders(out):
    held = []
    for p in glob.glob(os.path.join(out, ".farm.*.lock")):
        fd = os.open(p, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
        except BlockingIOError:
            held.append(open(p).read().strip())
        finally:
            os.close(fd)
    return held


def clean_stale_tmp(out):
    for p in glob.glob(os.path.join(out, "*.tmp")):
        m = re.search(r"\.(\d+)\.tmp$", p)
        alive = False
        if m:
            try:
                os.kill(int(m.group(1)), 0)
                alive = True
            except OSError:
                pass
        if not alive:
            try:
                os.remove(p)
            except OSError:
                pass


# --------------------------------------------------------------------------------------------- worker
class Stop:
    flag = False
    at = 0.0


class Interrupted(Exception):
    pass


class Fatal(Exception):
    pass


DEAD_RE = re.compile(r"Target (page, context or browser )?(has been )?closed|Browser has been closed|crashed|Connection closed|context lost|Session closed|Execution context was destroyed", re.I)


class Session:
    """One Chromium + one page showing the scene. restart() throws everything away and builds it again."""

    def __init__(self, a, port, tag):
        self.a, self.port, self.tag = a, port, tag
        self.pw = self.browser = self.page = None
        self.frames = 0
        self.count = 0

    def url(self):
        a = self.a
        return f"http://127.0.0.1:{self.port}/web/index.html?style={a.style}&shot={a.scene}&w={a.w}&h={a.h}&t=0" + ("&" + a.q if a.q else "")

    async def start(self):
        if FAKE_S:
            self.page = object()
            self.count += 1
            self.frames = 0
            return
        from playwright.async_api import async_playwright
        from shoot import CHROME_ARGS
        a = self.a
        self.pw = await asyncio.wait_for(async_playwright().start(), 60)
        self.browser = await asyncio.wait_for(self.pw.chromium.launch(args=CHROME_ARGS + ["--disable-dev-shm-usage", f"--zc-farm-owner={os.getpid()}"]), 90)
        self.page = await self.browser.new_page(viewport={"width": a.w, "height": a.h})
        q = "null" if a.jpgq is None else repr(float(a.jpgq))
        await self.page.add_init_script(INIT_JS.replace("__JPEGQ__", q))
        self.page.on("pageerror", lambda e: log("pageerror: " + str(e)[:400], self.tag))
        await self.page.goto(self.url(), timeout=a.boot_timeout * 1000)
        await self.page.wait_for_function("window.ready===true", timeout=a.boot_timeout * 1000, polling=500)
        err = await self.page.evaluate("window.__err || null")
        if err:
            raise Fatal("BUILD FAILED: " + str(err)[:1200])
        self.count += 1
        self.frames = 0

    async def stop(self):
        ok = True
        for what, t in ((self.browser, 20), (self.pw, 20)):
            if what is None:
                continue
            try:
                await asyncio.wait_for(what.close() if what is self.browser else what.stop(), t)
            except Exception:
                ok = False
        if not ok:
            kill_descendants()
        self.pw = self.browser = self.page = None

    async def restart(self, why=""):
        log(f"recreating browser ({why})", self.tag)
        await self.stop()
        kill_descendants()          # leftovers of a crashed or hung browser
        await asyncio.sleep(1.0)
        await self.start()

    async def grab(self, t):
        a = self.a
        if FAKE_S:
            await asyncio.sleep(float(FAKE_S))
            from PIL import Image, ImageDraw
            im = Image.new("RGB", (a.w, a.h), (int(t * 40) % 256, 90, 140))
            ImageDraw.Draw(im).text((8, 8), f"t={t:.4f}", fill=(255, 255, 255))
            buf = io.BytesIO()
            im.save(buf, "PNG" if a.fmt == "png" else "JPEG", quality=85)
            return f"data:image/{'png' if a.fmt == 'png' else 'jpeg'};base64," + base64.b64encode(buf.getvalue()).decode()
        task = asyncio.ensure_future(self.page.evaluate(JS_FRAME, [t, "jpg" if a.fmt == "jpeg" else a.fmt]))
        deadline = time.time() + a.timeout
        while True:
            done, _ = await asyncio.wait({task}, timeout=1.0)
            if done:
                return task.result()
            if time.time() > deadline:
                task.cancel()
                raise TimeoutError(f"frame took more than {a.timeout} s")
            if Stop.flag and time.time() - Stop.at > a.term_grace:
                task.cancel()
                raise Interrupted()


class Worker:
    def __init__(self, a, plan, k, n):
        self.a, self.plan, self.k, self.n = a, plan, k, n
        self.tag = f"[{k}/{n}] "
        self.done = self.rendered = self.skipped = self.planned = 0
        self.failed = []
        self.last_error = None
        self.recent = []
        self.t_run = time.time()
        self.sess = None
        self.inject = self._parse_inject()
        self.inject_seen = {}
        base = a.progress_file or ("progress.json" if n == 1 else f"progress.{k}of{n}.json")
        self.pfile = os.path.join(a.out, base)
        self.hb = os.path.join(a.out, f".hb.{k}of{n}")
        self.parent = os.getppid()

    @staticmethod
    def _parse_inject():
        out = {}
        for part in filter(None, os.environ.get("ZC_FARM_INJECT", "").split(",")):
            kind, frame, cnt = (part.split(":") + ["1"])[:3]
            out[(kind, int(frame))] = int(cnt)
        return out

    def heartbeat(self, frame=None):
        try:
            with open(self.hb, "w") as f:
                json.dump({"epoch": time.time(), "frame": frame}, f)
        except OSError:
            pass

    def progress(self, state="running"):
        spf = (sum(self.recent) / len(self.recent)) if self.recent else None
        left = self.planned - self.done
        write_json_atomic(self.pfile, {
            "shard": f"{self.k}/{self.n}", "pid": os.getpid(), "state": state, "planned": self.planned, "done": self.done,
            "rendered_this_run": self.rendered, "skipped_valid": self.skipped, "failed_frames": self.failed[-50:], "failed_count": len(self.failed),
            "seconds_per_frame": round(spf, 2) if spf else None, "eta_s": round(left * spf) if spf else None,
            "browser_sessions": self.sess.count if self.sess else 0, "last_error": self.last_error,
            "updated": time.strftime("%F %T"), "updated_epoch": time.time(), "started_epoch": self.t_run,
        })

    def injected(self, kind, i):
        key = (kind, i)
        if key not in self.inject:
            return False
        if kind in ("exit", "hardhang"):                       # once per directory: survives the restart
            mark = os.path.join(self.a.out, f".inject_{kind}_{i}")
            if os.path.exists(mark):
                return False
            open(mark, "w").close()
            return True
        self.inject_seen[key] = self.inject_seen.get(key, 0) + 1
        return self.inject_seen[key] <= self.inject[key]

    def write_frame(self, i, raw):
        a, plan = self.a, self.plan
        want = b"\xff\xd8\xff" if plan.ext == "jpg" else b"\x89PNG"
        if raw[:len(want)] != want:
            raise RuntimeError("frame data has the wrong image type")
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as im:
            if im.size != (a.w, a.h):
                raise RuntimeError(f"frame is {im.size}, expected {(a.w, a.h)}")
        path = plan.path(i)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)

    async def render_one(self, i):
        a = self.a
        t = self.plan.t_of(i)
        for attempt in range(a.retries + 1):
            try:
                if self.injected("exit", i):
                    log(f"INJECT: worker exits at frame {i}", self.tag)
                    os._exit(9)
                if self.injected("hardhang", i):
                    log(f"INJECT: event loop blocked at frame {i}", self.tag)
                    time.sleep(10 ** 6)
                if self.injected("crash", i):
                    log(f"INJECT: browser killed before frame {i}", self.tag)
                    kill_descendants()
                    await asyncio.sleep(0.5)
                if self.injected("fail", i):
                    raise RuntimeError("injected failure")
                if self.injected("hang", i):
                    await self._hang()
                data = await self.sess.grab(t)
                self.write_frame(i, base64.b64decode(data.split(",", 1)[1]))
                self.sess.frames += 1
                return True
            except (Interrupted, Fatal, KeyboardInterrupt, SystemExit):
                raise
            except BaseException as e:
                if isinstance(e, asyncio.CancelledError):
                    raise
                first = str(e).strip().splitlines()[0][:220] if str(e).strip() else ""
                msg = f"{type(e).__name__}: {first}"
                self.last_error = f"frame {i} attempt {attempt + 1}/{a.retries + 1}: {msg}"
                log(self.last_error, self.tag)
                self.progress()
                if attempt >= a.retries:
                    return False
                dead = isinstance(e, TimeoutError) or DEAD_RE.search(str(e) or "") or self.sess.page is None
                try:
                    if dead or attempt >= 1:
                        await self.sess.restart(f"frame {i}, {msg[:60]}")
                    else:
                        await asyncio.sleep(1.0)
                except Fatal:
                    raise
                except Exception as e2:
                    log(f"restart failed: {type(e2).__name__}: {str(e2)[:200]}", self.tag)
                    await asyncio.sleep(3.0)
        return False

    async def _hang(self):
        # stands in for a page that never answers: nothing is sent to the page, the soft timeout has to notice
        deadline = time.time() + self.a.timeout
        while time.time() < deadline:
            await asyncio.sleep(0.5)
        raise TimeoutError(f"frame took more than {self.a.timeout} s (injected hang)")

    async def beat(self):
        ppid = self.parent
        while True:
            try:
                os.utime(self.hb, None)
            except OSError:
                self.heartbeat()
            if self.a.child and os.getppid() != ppid and not Stop.flag:
                Stop.flag, Stop.at = True, time.time()
                log("the supervisor is gone: finishing the current frame, then exiting", self.tag)
            await asyncio.sleep(5)

    async def run(self):
        a, plan, k, n = self.a, self.plan, self.k, self.n
        mine = plan.shard_frames(k, n)
        if a.limit:
            mine = mine[:a.limit]
        self.planned = len(mine)
        todo = []
        for i in mine:
            if frame_ok(plan.path(i), a.w, a.h, a.verify):
                self.skipped += 1
            else:
                todo.append(i)
        self.done = self.skipped
        log(f"{len(mine)} frames planned, {self.skipped} already valid, {len(todo)} to render", self.tag)
        self.heartbeat()
        self.progress("starting")
        if not todo:
            self.progress("finished")
            return 0
        from shoot import serve
        srv = serve(0)
        self.sess = Session(a, srv.server_address[1], self.tag)
        loop = asyncio.get_running_loop()

        def on_signal():
            Stop.flag, Stop.at = True, time.time()
            log("stop requested: finishing the current frame", self.tag)
        for sg in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sg, on_signal)
        beat = asyncio.ensure_future(self.beat())
        state, rc, consecutive = "finished", 0, 0
        try:
            boots = 0
            while True:
                try:
                    await self.sess.start()
                    break
                except Fatal:
                    raise
                except Exception as e:
                    boots += 1
                    log(f"browser start failed ({boots}): {type(e).__name__}: {str(e)[:200]}", self.tag)
                    await self.sess.stop()
                    kill_descendants()
                    if boots >= 3:
                        raise Fatal(f"browser would not start: {e}")
                    await asyncio.sleep(3)
            for j, i in enumerate(todo):
                if Stop.flag:
                    state, rc = "terminated", 143
                    break
                if self.sess.frames >= a.recycle or (j % 10 == 0 and self.sess.frames > 20 and mem_available_mb() < a.min_mem_mb):
                    await self.sess.restart(f"recycle after {self.sess.frames} frames, {mem_available_mb()} MB free")
                t0 = time.time()
                ok = await self.render_one(i)
                dt = time.time() - t0
                if ok:
                    consecutive = 0
                    self.rendered += 1
                    self.done += 1
                    self.recent = (self.recent + [dt])[-20:]
                else:
                    consecutive += 1
                    self.failed.append(i)
                    log(f"GIVING UP on frame {i} (t={plan.t_of(i):.3f}) after {a.retries + 1} attempts", self.tag)
                    if consecutive >= a.max_consecutive_fail:
                        state, rc = "failed", 3
                        log(f"{consecutive} frames failed in a row: stopping this worker", self.tag)
                        break
                self.heartbeat(i)
                if self.rendered % 10 == 0 or not ok or self.rendered == 1:
                    spf = sum(self.recent) / len(self.recent) if self.recent else 0
                    log(f"{self.done}/{self.planned}  t={plan.t_of(i):.2f}  {spf:.1f}s/frame  eta {fmt_hms((self.planned - self.done) * spf)}", self.tag)
                    self.progress()
        except Interrupted:
            state, rc = "terminated", 143
        except Fatal as e:
            self.last_error = str(e)
            log(str(e), self.tag)
            state, rc = "fatal", 2
        finally:
            beat.cancel()
            await self.sess.stop()
            srv.shutdown()
        if rc == 0 and self.failed:
            state, rc = "finished_with_missing", 1
        self.progress(state)
        log(f"{state}: rendered {self.rendered}, skipped {self.skipped}, failed {len(self.failed)}", self.tag)
        return rc


def run_worker(a):
    plan = Plan(a)
    k, n = parse_shard(a.shard)
    os.makedirs(a.out, exist_ok=True)
    if not a.child:
        fd, why = acquire_lock(a.out, k, n)
        if fd is None:
            log("REFUSED: " + why)
            return 75
        clean_stale_tmp(a.out)
        write_run_json(a)
    w = Worker(a, plan, k, n)
    rc = asyncio.run(w.run())
    if rc == 0 and n == 1 and plan.on > 1 and not a.child:
        filled, mb = fill_gaps(plan, a.link)
        log(f"filled {filled} repeated frames" + (f", {len(mb)} could not be filled" if mb else ""))
    return rc


# --------------------------------------------------------------------------------------------- supervisor
def write_run_json(a):
    keys = {"scene": a.scene, "style": a.style, "q": a.q, "w": a.w, "h": a.h, "fmt": "jpg" if a.fmt == "jpeg" else a.fmt, "fps": a.fps, "on": a.on, "jpgq": a.jpgq}
    p = os.path.join(a.out, "run.json")
    old = read_json(p)
    if old and not a.force:
        diff = {k: (old.get(k), v) for k, v in keys.items() if old.get(k) != v}
        if diff:
            raise SystemExit("this directory was rendered with other settings: " + "; ".join(f"{k}: {o!r} now {n!r}" for k, (o, n) in diff.items())
                             + "\n(use another --out, or --force to keep mixing)")
    keys["updated"] = time.strftime("%F %T")
    write_json_atomic(p, keys)


def merge_progress(a, plan, procs, state, extra=None):
    parts = [read_json(os.path.join(a.out, f"progress.{k}of{procs}.json")) for k in range(procs)]
    parts = [p for p in parts if p]
    planned = sum(p["planned"] for p in parts)
    done = sum(p["done"] for p in parts)
    rates = [1.0 / p["seconds_per_frame"] for p in parts if p.get("seconds_per_frame") and p["state"] == "running"]
    spf = 1.0 / sum(rates) if rates else None
    errs = [p["last_error"] for p in parts if p.get("last_error")]
    d = {"state": state, "planned": planned, "done": done, "seconds_per_frame": round(spf, 2) if spf else None,
         "eta_s": round((planned - done) * spf) if spf else None, "failed_count": sum(p.get("failed_count", 0) for p in parts),
         "last_error": errs[-1] if errs else None, "workers": procs, "supervisor_pid": os.getpid(),
         "total_frames_incl_repeats": len(plan.frames), "updated": time.strftime("%F %T"), "updated_epoch": time.time(), "started_epoch": T_START}
    if extra:
        d.update(extra)
    write_json_atomic(os.path.join(a.out, "progress.json"), d)
    return d


def die_with_parent():
    """preexec for workers: SIGTERM when the supervisor dies (even by kill -9); reniced."""
    try:
        import ctypes
        ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, int(signal.SIGTERM))
    except Exception:
        pass


def sig(pr, s):
    try:
        pr.send_signal(s)
    except OSError:
        pass


def killpg(pr):
    try:
        os.killpg(pr.pid, signal.SIGKILL)
    except OSError:
        pass


def supervise(a):
    plan = Plan(a)
    os.makedirs(a.out, exist_ok=True)
    fd, why = acquire_lock(a.out, 0, 1)
    if fd is None:
        log("REFUSED: " + why)
        return 75
    clean_stale_tmp(a.out)
    write_run_json(a)
    procs = max(1, a.procs)
    stop = {"flag": False}

    def on_term(sg, fr):
        stop["flag"] = True
        log("stop requested: the workers finish their current frame")
    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    log(f"plan: {len(plan.frames)} frames ({len(plan.render)} rendered, {len(plan.frames) - len(plan.render)} repeats), {procs} worker(s), "
        f"{len(missing_rendered(plan))} rendered frames not on disk yet; out={a.out}")
    restarts = {k: 0 for k in range(procs)}
    fatal = None
    for pass_no in range(1 + a.passes):
        if pass_no:
            log(f"extra pass {pass_no}: retrying the frames that are still missing")
        alive = {}

        def spawn(k):
            cmd = [sys.executable, "-u", os.path.abspath(__file__)] + child_args(a, k, procs)
            nice = a.nice

            def pre():
                die_with_parent()
                if nice:
                    os.nice(nice)
            pr = subprocess.Popen(cmd, start_new_session=True, preexec_fn=pre)
            try:
                os.remove(os.path.join(a.out, f".hb.{k}of{procs}"))
            except OSError:
                pass
            alive[k] = {"p": pr, "since": time.time()}
        for k in range(procs):
            spawn(k)
        last_merge, term_at = 0, None
        while alive:
            time.sleep(1.0)
            now = time.time()
            if stop["flag"] and term_at is None:
                term_at = now
                for v in alive.values():
                    sig(v["p"], signal.SIGTERM)
            if term_at and now - term_at > a.term_grace + 20:
                for v in alive.values():
                    killpg(v["p"])
            for k, v in list(alive.items()):
                pr = v["p"]
                rc = pr.poll()
                if rc is None:
                    hbp = os.path.join(a.out, f".hb.{k}of{procs}")
                    hb = read_json(hbp)
                    stalled = now - (hb["epoch"] if hb else v["since"] + a.boot_timeout)
                    try:
                        loop_dead = now - os.path.getmtime(hbp) > 60
                    except OSError:
                        loop_dead = False
                    if not stop["flag"] and now - v["since"] > 30 and (stalled > a.hard_timeout or loop_dead):
                        log(f"worker {k}/{procs}: no progress for {int(max(stalled, 0))} s, killing its process group")
                        killpg(pr)
                    continue
                del alive[k]
                killpg(pr)                                     # whatever the worker left behind
                if stop["flag"] or rc in (0, 1):
                    continue
                if rc in (2, 3):
                    fatal = rc
                    log(f"worker {k}/{procs} exited with {rc} (systematic failure): not restarting, stopping the others")
                    for v2 in alive.values():
                        sig(v2["p"], signal.SIGTERM)
                    continue
                restarts[k] += 1
                if restarts[k] > a.child_restarts:
                    log(f"worker {k}/{procs} died again (exit {rc}): giving up on it")
                    continue
                log(f"worker {k}/{procs} exited with {rc}: restart {restarts[k]}/{a.child_restarts} (it resumes where it stopped)")
                time.sleep(3)
                spawn(k)
            if now - last_merge > 5:
                merge_progress(a, plan, procs, "running")
                last_merge = now
        if stop["flag"] or fatal or a.limit or not missing_rendered(plan):
            break
    if stop["flag"]:
        merge_progress(a, plan, procs, "terminated")
        log("terminated on request; run the same command again to resume")
        return 143
    if fatal:
        merge_progress(a, plan, procs, "fatal")
        return fatal
    if plan.on > 1:
        filled, mb = fill_gaps(plan, a.link)
        log(f"filled {filled} repeated frames" + (f", {len(mb)} could not be filled" if mb else ""))
    miss = [] if a.limit else missing_frames(plan, a.verify)
    write_missing(a, plan, miss)
    merge_progress(a, plan, procs, "done" if not miss else "incomplete", {"missing_count": len(miss)})
    if miss:
        log(f"INCOMPLETE: {len(miss)} frames missing (first: {[i - plan.offset for i in miss[:10]]}); list in {os.path.join(a.out, 'missing.txt')}")
        return 1
    log(f"COMPLETE: {len(plan.frames)} frames in {a.out} ({fmt_hms(time.time() - T_START)})")
    return 0


def write_missing(a, plan, miss):
    p = os.path.join(a.out, "missing.txt")
    if not miss:
        try:
            os.remove(p)
        except OSError:
            pass
        return
    with open(p, "w") as f:
        f.write("# frame numbers (file f_%05d) that are missing or invalid; run the same command again to render them\n")
        f.write("\n".join(str(i - plan.offset) for i in miss) + "\n")


def child_args(a, k, procs):
    c = ["--scene", a.scene, "--style", a.style, "--fps", str(a.fps), "--on", str(a.on), "--w", str(a.w), "--h", str(a.h), "--out", a.out,
         "--shard", f"{k}/{procs}", "--fmt", a.fmt, "--q", a.q, "--timeout", str(a.timeout), "--retries", str(a.retries), "--recycle", str(a.recycle),
         "--boot-timeout", str(a.boot_timeout), "--term-grace", str(a.term_grace), "--min-mem-mb", str(a.min_mem_mb),
         "--max-consecutive-fail", str(a.max_consecutive_fail), "--child", "--progress-file", f"progress.{k}of{procs}.json"]
    if a.jpgq is not None:
        c += ["--jpgq", str(a.jpgq)]
    if a.limit:
        c += ["--limit", str(a.limit)]
    if a.shots:
        c += ["--shots", a.shots]
    if a.only:
        c += ["--only", a.only]
    if a.range:
        c += ["--range", a.range]
    else:
        c += ["--t0", str(a.t0)]
        if a.t1 is not None:
            c += ["--t1", str(a.t1)]
    if a.verify:
        c.append("--verify")
    if a.rel:
        c.append("--rel")
    return c


# --------------------------------------------------------------------------------------------- cli
def show_status(a):
    p = read_json(os.path.join(a.out, "progress.json"))
    if not p:
        print(f"no progress.json in {a.out}")
        return 1
    age = time.time() - p.get("updated_epoch", 0)
    pct = 100.0 * p["done"] / p["planned"] if p.get("planned") else 0
    print(f"{p['state']}: {p['done']}/{p['planned']} frames ({pct:.1f}%)  {p.get('seconds_per_frame')} s/frame  eta {fmt_hms(p.get('eta_s'))}  "
          f"updated {int(age)} s ago" + ("  STALLED?" if p["state"] == "running" and age > 300 else ""))
    if p.get("failed_count"):
        print(f"  failed frames so far: {p['failed_count']}")
    if p.get("last_error"):
        print(f"  last error: {p['last_error']}")
    if p.get("missing_count"):
        print(f"  missing at the end: {p['missing_count']} (see missing.txt)")
    return 0


def build_parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", default="story")
    ap.add_argument("--style", default="felt")
    ap.add_argument("--t0", type=float, default=0)
    ap.add_argument("--t1", type=float, default=None)
    ap.add_argument("--range", default="", help="a:b seconds (absolute frame numbers)")
    ap.add_argument("--only", default="", help="shot ids or section ids, comma separated (needs --shots)")
    ap.add_argument("--shots", default="", help="data/shots.json")
    ap.add_argument("--fps", type=float, default=24)
    ap.add_argument("--on", type=int, default=1, help="render every Nth frame, repeat in between (stop-motion 'on twos')")
    ap.add_argument("--w", type=int, default=960)
    ap.add_argument("--h", type=int, default=540)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--fmt", default="jpg", choices=["jpg", "jpeg", "png"])
    ap.add_argument("--jpgq", type=float, default=None, help="JPEG quality 0..1 (the page default is 0.94)")
    ap.add_argument("--q", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--rel", action="store_true", help="number files from 0 at the first frame (old behaviour with --t0)")
    ap.add_argument("--timeout", type=float, default=180, help="seconds per frame attempt")
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--recycle", type=int, default=300)
    ap.add_argument("--boot-timeout", type=float, default=300)
    ap.add_argument("--min-mem-mb", type=int, default=600)
    ap.add_argument("--max-consecutive-fail", type=int, default=8)
    ap.add_argument("--verify", action="store_true", help="fully decode existing frames when resuming and at the end")
    ap.add_argument("--procs", type=int, default=DEFAULT_PROCS, help="worker processes (shards) started by the supervisor")
    ap.add_argument("--nice", type=int, default=5)
    ap.add_argument("--hard-timeout", type=float, default=900)
    ap.add_argument("--child-restarts", type=int, default=5)
    ap.add_argument("--passes", type=int, default=1, help="extra passes for frames that stayed missing")
    ap.add_argument("--term-grace", type=float, default=90)
    ap.add_argument("--link", action="store_true", help="fill repeats with hard links instead of copies (saves disk)")
    ap.add_argument("--fill-only", action="store_true")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--lock-status", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore a run.json settings mismatch")
    ap.add_argument("--no-supervise", action="store_true", help="run the worker in this process (debugging)")
    ap.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--progress-file", default="", help=argparse.SUPPRESS)
    return ap


def main():
    a = build_parser().parse_args()
    a.out = os.path.abspath(a.out)
    if a.status:
        return show_status(a)
    if a.lock_status:
        held = lock_holders(a.out)
        if held:
            print("in use: " + "; ".join(held))
            return 1
        print("free")
        return 0
    if a.fill_only or a.plan:
        plan = Plan(a)
        if a.plan:
            n = max(1, a.procs)
            print(f"{len(plan.frames)} frames [{plan.frames[0] if plan.frames else '-'}..{plan.frames[-1] if plan.frames else '-'}], {len(plan.render)} rendered, "
                  f"{len(plan.frames) - len(plan.render)} repeats, {len(plan.shots)} shots known, windows {[(round(x, 2), round(y, 2)) for x, y in plan.windows][:8]}")
            for k in range(n):
                print(f"  shard {k}/{n}: {len(plan.shard_frames(k, n))} frames")
            return 0
        os.makedirs(a.out, exist_ok=True)
        filled, mb = fill_gaps(plan, a.link)
        miss = missing_frames(plan, a.verify)
        write_missing(a, plan, miss)
        print(f"filled {filled} repeated frames; {len(miss)} frames still missing" + (f" (first {[i - plan.offset for i in miss[:10]]})" if miss else ""))
        return 1 if miss else 0
    if a.child or a.no_supervise or parse_shard(a.shard) != (0, 1):
        return run_worker(a)
    return supervise(a)


if __name__ == "__main__":
    sys.exit(main())
