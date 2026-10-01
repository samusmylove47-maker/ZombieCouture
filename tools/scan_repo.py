#!/usr/bin/env python3
"""Scan a directory that is about to be published. Exit code 1 if anything is found.

  python3 tools/scan_repo.py publish/repo [--allow-email a@b.c ...] [--allow-code-file web/sets/card.js ...] [--lyrics data/lyrics.txt] [--json]

Fails on:
  * the Suno account name (anywhere except the exact credit line "Lyrics: <name> & ShaeAI"; in code files only in --allow-code-file files
    and not in a comment; file names and paths are checked too)
  * e-mail addresses (except --allow-email and example/noreply addresses)
  * absolute paths that exist only on the build machine (the build user's home and root directories, the sandbox's tmp, session and upload folders,
    macOS and Windows user folders)
  * API keys and tokens (sk-..., AKIA..., ghp_..., github_pat_..., xox?-..., AIza..., hf_..., JWTs, private key blocks, key = "long string")
  * files over 5 MB, audio files (.mp3 .wav .flac .ogg .m4a .aac .opus .aiff), model weights (.onnx .pt .pth .ckpt .safetensors)
  * claude.ai session / chat / artifact URLs and session ids
  * secret-looking file names (.env, id_rsa, *.pem, credentials*)
  * lyrics: three or more full lyric lines (5+ words) from --lyrics in one file fail; one or two are reported as a note
"""
import argparse, json, os, re, sys

# the account name is spelled out as numbers so that this file passes its own scan
NAME = "".join(map(chr, [83, 121, 114, 105, 98, 101, 116, 104]))
CREDIT_RE = re.compile(r"Lyrics: " + re.escape(NAME) + r" (?:&amp;|&|and) ShaeAI", re.I)
NAME_RE = re.compile(re.escape(NAME), re.I)
TEXT_DOC_EXT = {".md", ".txt", ".html", ".htm", ".rst"}
CODE_EXT = {".js", ".mjs", ".cjs", ".py", ".sh", ".json", ".css", ".ts", ".yml", ".yaml", ".toml", ".cfg", ".ini"}
AUDIO_EXT = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".aiff", ".aif", ".wma"}
MODEL_EXT = {".onnx", ".pt", ".pth", ".ckpt", ".safetensors", ".gguf"}
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
EMAIL_OK = re.compile(r"(@example\.|@users\.noreply\.github\.com$|^noreply@anthropic\.com$|^git@github\.com$)", re.I)
# written in pieces so that this file does not trip its own scan
PATH_RES = [re.compile(p) for p in (r"/ho" r"me/claude", r"/tm" r"p/claude-", r"/tm" r"p/zc/", r"/ro" r"ot/", r"/Us" r"ers/[A-Za-z]", r"[A-Za-z]:\\Us" r"ers\\", r"/mnt/us" r"er-data", r"/sess" r"ions/[a-z0-9-]+")]
SECRET_RES = [
    ("API key (sk-)", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}")),
    ("Hugging Face token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY")),
    ("bearer token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{30,}")),
    ("secret assignment", re.compile(r"(?i)\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b\s*[:=]\s*[\"'][A-Za-z0-9/+_=.-]{20,}[\"']")),
]
URL_RES = [re.compile(r"claude\.ai/(?:code|chat|artifact|share|project)/[A-Za-z0-9_-]+", re.I), re.compile(r"\bsession_[A-Za-z0-9]{16,}")]
SECRET_NAMES = re.compile(r"(^\.env(\..*)?$|^id_(rsa|dsa|ecdsa|ed25519)$|\.pem$|\.p12$|\.pfx$|^credentials(\..*)?$|^\.netrc$)", re.I)
MAX_BYTES = 5 * 1024 * 1024


def norm_words(s):
    return re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("’", "'")).split()


def is_comment_line(line, ext):
    s = line.strip()
    if ext in (".js", ".mjs", ".cjs", ".ts", ".css"):
        return s.startswith(("//", "/*", "*")) or re.search(r"\s//\s", line) is not None
    if ext in (".py", ".sh", ".yml", ".yaml", ".toml", ".cfg", ".ini"):
        return s.startswith("#") or re.search(r"\s#\s", line) is not None
    return False


def scan(root, allow_email=(), allow_code=(), lyrics_path=None, big=MAX_BYTES):
    root = os.path.abspath(root)
    findings, notes = [], []
    allow_email = {e.lower() for e in allow_email}
    allow_code = {c.replace("\\", "/") for c in allow_code}
    lyric_lines = []
    if lyrics_path and os.path.exists(lyrics_path):
        for ln in open(lyrics_path, encoding="utf-8", errors="ignore"):
            ln = ln.strip()
            if ln and not ln.startswith("["):
                w = norm_words(ln)
                if len(w) >= 5:
                    lyric_lines.append(" ".join(w))

    def add(path, line, rule, msg):
        findings.append({"file": os.path.relpath(path, root), "line": line, "rule": rule, "msg": msg})

    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            path = os.path.join(dp, fn)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            ext = os.path.splitext(fn)[1].lower()
            if NAME_RE.search(rel):
                add(path, 0, "name", "the account name is in the file path")
            if SECRET_NAMES.search(fn):
                add(path, 0, "secret file", "file name looks like a credential file")
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if ext in AUDIO_EXT:
                add(path, 0, "audio", f"audio file ({size / 1e6:.1f} MB)")
            if ext in MODEL_EXT:
                add(path, 0, "model", f"model weights ({size / 1e6:.1f} MB)")
            if size > big:
                add(path, 0, "big file", f"{size / 1e6:.1f} MB (limit {big / 1e6:.0f} MB)")
                continue
            try:
                raw = open(path, "rb").read()
            except OSError:
                continue
            if NAME.encode().lower() in raw.lower() and b"\x00" in raw[:4096]:
                add(path, 0, "name", "the account name is inside a binary file (metadata?)")
            if b"\x00" in raw[:4096]:
                continue                                     # binary: only the checks above
            text = raw.decode("utf-8", errors="replace")
            lines = text.split("\n")
            hits_lyrics = set()
            for n, line in enumerate(lines, 1):
                for m in NAME_RE.finditer(line):
                    spans = [c.span() for c in CREDIT_RE.finditer(line)]
                    if not any(a <= m.start() and m.end() <= b for a, b in spans):
                        add(path, n, "name", "the account name outside the exact credit line: " + line.strip()[:90])
                    elif ext in CODE_EXT and ext not in TEXT_DOC_EXT:
                        if rel not in allow_code:
                            add(path, n, "name", "the credit line in a code file that is not on the allow list")
                        elif is_comment_line(line, ext):
                            add(path, n, "name", "the credit line in a code comment")
                for m in EMAIL_RE.finditer(line):
                    e = m.group(0)
                    if e.lower() in allow_email or EMAIL_OK.search(e):
                        continue
                    add(path, n, "email", e)
                for r in PATH_RES:
                    m = r.search(line)
                    if m:
                        add(path, n, "path", f"absolute path of the build machine ({m.group(0)}...): " + line.strip()[:90])
                        break
                for label, r in SECRET_RES:
                    if r.search(line):
                        add(path, n, "secret", label)
                for r in URL_RES:
                    m = r.search(line)
                    if m:
                        add(path, n, "session url", m.group(0)[:60])
                if lyric_lines:
                    nl = " ".join(norm_words(line))
                    for ll in lyric_lines:
                        if ll in nl:
                            hits_lyrics.add(ll)
            if len(hits_lyrics) >= 3:
                add(path, 0, "lyrics", f"{len(hits_lyrics)} full lyric lines (the song's words are not to be published unless the director says so)")
            elif hits_lyrics:
                notes.append(f"{rel}: quotes {len(hits_lyrics)} full lyric line(s): {sorted(hits_lyrics)[0][:50]}...")
    return findings, notes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir")
    ap.add_argument("--allow-email", action="append", default=[])
    ap.add_argument("--allow-code-file", action="append", default=["web/text.js", "web/sets/card.js"])
    ap.add_argument("--lyrics", default=None, help="lyrics file whose lines must not appear in bulk")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not os.path.isdir(a.dir):
        print(f"not a directory: {a.dir}", file=sys.stderr)
        return 2
    findings, notes = scan(a.dir, a.allow_email, a.allow_code_file, a.lyrics)
    if a.json:
        print(json.dumps({"findings": findings, "notes": notes}, indent=1))
    else:
        for f in findings:
            print(f"{f['file']}{':' + str(f['line']) if f['line'] else ''}: [{f['rule']}] {f['msg']}")
        for n in notes:
            print("note:", n)
        print(f"{'FAILED' if findings else 'CLEAN'}: {len(findings)} finding(s) in {a.dir}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
