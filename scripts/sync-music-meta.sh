#!/usr/bin/env bash
# sync-music-meta.sh - metadata-only playlist sync into static/music/music.json
#
# Usage:
#   ./scripts/sync-music-meta.sh
#   ./scripts/sync-music-meta.sh --limit 20
#   ./scripts/sync-music-meta.sh "OTHER_URL"   # optional override
#
# Requires: yt-dlp + python3 on PATH. macOS `sips` is used to build square covers.
# Never downloads audio/video - JSON metadata + YouTube thumbnail stills only.
# Optional private playlists: export YTDLP_COOKIES_FROM_BROWSER=chrome (or safari, firefox)
#
# Only sync playlists you intend to embed via the official YouTube player on your site.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/static/music/music.json"
COVERS="$ROOT/static/music/covers"
CACHE="$ROOT/scripts/.music-cache"
LIMIT=30
# Default mix - Ankush's YouTube Music playlist
DEFAULT_URL="https://www.youtube.com/playlist?list=PLGYjQsvvGQYQ"
URL="$DEFAULT_URL"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:-30}"
      shift 2
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

if [[ -z "$URL" ]]; then
  echo "No playlist URL configured" >&2
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp is required on PATH" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required on PATH" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required (macOS) to build square cover art" >&2
  exit 1
fi

if [[ "$LIMIT" -gt 30 ]]; then
  echo "Limit capped at 30 (got $LIMIT)" >&2
  LIMIT=30
fi

mkdir -p "$CACHE" "$COVERS"
RAW="$CACHE/playlist.json"

YTDLP_ARGS=(--flat-playlist --skip-download -J --playlist-end "$LIMIT")
if [[ -n "${YTDLP_COOKIES_FROM_BROWSER:-}" ]]; then
  YTDLP_ARGS+=(--cookies-from-browser "$YTDLP_COOKIES_FROM_BROWSER")
fi

echo "Fetching metadata from: $URL" >&2
echo "(no media download)" >&2
yt-dlp "${YTDLP_ARGS[@]}" "$URL" >"$RAW"

python3 - "$RAW" "$OUT" "$COVERS" "$LIMIT" <<'PY'
import hashlib, json, re, struct, subprocess, sys, urllib.request
from datetime import date
from pathlib import Path

raw_path, out_path, covers_dir, limit = sys.argv[1], sys.argv[2], Path(sys.argv[3]), int(sys.argv[4])
covers_dir.mkdir(parents=True, exist_ok=True)
tmp_dir = Path(raw_path).parent / "cover-tmp"
tmp_dir.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (compatible; ankushKun-music-sync/1.0)"}
VARIANTS = ("maxresdefault.jpg", "hq720.jpg", "sddefault.jpg", "hqdefault.jpg")

with open(raw_path, "r", encoding="utf-8") as f:
    data = json.load(f)

def clean(s, n):
    s = "" if s is None else str(s)
    s = re.sub(r"[\x00-\x1f\x7f]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n]

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def jpeg_wh(blob):
    i = 2
    while i < len(blob) - 8:
        if blob[i] != 0xFF:
            i += 1
            continue
        marker = blob[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", blob[i + 5 : i + 9])
            return w, h
        if marker == 0xD9:
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        length = struct.unpack(">H", blob[i + 2 : i + 4])[0]
        i += 2 + length
    return None, None

def pick_source(vid):
    for name in VARIANTS:
        url = f"https://i.ytimg.com/vi/{vid}/{name}"
        try:
            blob = fetch(url)
        except Exception:
            continue
        w, h = jpeg_wh(blob)
        # YouTube returns a tiny placeholder when maxres is missing
        if not w or not h or w <= 120 or h <= 90:
            continue
        return url, blob, w, h, name
    return None, None, None, None, None

def content_square(bmp_path):
    raw = Path(bmp_path).read_bytes()
    pix_off = struct.unpack_from("<I", raw, 10)[0]
    w, h_signed = struct.unpack_from("<ii", raw, 18)
    h = abs(h_signed)
    top_down = h_signed < 0
    bpp = struct.unpack_from("<H", raw, 28)[0]
    row_size = ((w * bpp + 31) // 32) * 4
    pixels = raw[pix_off:]

    def lum(x, y):
        by = y if top_down else (h - 1 - y)
        i = by * row_size + x * (bpp // 8)
        b, g, r = pixels[i], pixels[i + 1], pixels[i + 2]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    def row_avg(y, step=6):
        xs = list(range(0, w, step))
        return sum(lum(x, y) for x in xs) / len(xs)

    def col_avg(x, y0, y1, step=4):
        ys = list(range(y0, y1 + 1, step))
        return sum(lum(x, y) for y in ys) / max(1, len(ys))

    mid = sum(row_avg(y) for y in range(h // 2 - 2, h // 2 + 3)) / 5
    thr = max(16.0, mid * 0.14)

    first = 0
    for y in range(h):
        if row_avg(y) > thr:
            first = y
            break
    last = h - 1
    for y in range(h - 1, -1, -1):
        if row_avg(y) > thr:
            last = y
            break

    cleft = 0
    for x in range(w):
        if col_avg(x, first, last) > thr:
            cleft = x
            break
    cright = w - 1
    for x in range(w - 1, -1, -1):
        if col_avg(x, first, last) > thr:
            cright = x
            break

    cw = cright - cleft + 1
    ch = last - first + 1
    if cw < w * 0.35 or ch < h * 0.35:
        side = min(w, h)
        return (w - side) // 2, (h - side) // 2, side

    side = min(cw, ch)
    x = cleft + (cw - side) // 2
    y = first + (ch - side) // 2
    return x, y, side

def build_cover(vid, blob):
    src = tmp_dir / f"{vid}.src.jpg"
    bmp = tmp_dir / f"{vid}.bmp"
    out = covers_dir / f"{vid}.jpg"
    src.write_bytes(blob)
    subprocess.run(
        ["sips", "-s", "format", "bmp", str(src), "--out", str(bmp)],
        check=True,
        capture_output=True,
    )
    x, y, side = content_square(bmp)
    # sips --cropOffset is offsetY offsetH
    subprocess.run(
        [
            "sips",
            "--cropToHeightWidth",
            str(side),
            str(side),
            "--cropOffset",
            str(y),
            str(x),
            str(src),
            "--out",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(["sips", "-Z", "640", str(out)], check=True, capture_output=True)
    return f"/music/covers/{vid}.jpg"

entries = data.get("entries") or []
tracks = []
keep_ids = set()
for entry in entries:
    if not entry:
        continue
    vid = entry.get("id") or entry.get("url") or ""
    if "watch?v=" in str(vid):
        m = re.search(r"v=([\w-]{11})", str(vid))
        vid = m.group(1) if m else ""
    vid = str(vid).strip()
    if not re.fullmatch(r"[\w-]{11}", vid):
        continue

    title = clean(entry.get("title") or entry.get("track") or "Unknown", 80)
    artist = clean(
        entry.get("artist")
        or entry.get("uploader")
        or entry.get("channel")
        or entry.get("creator")
        or "",
        60,
    )
    if not artist and " - " in title:
        left, right = title.split(" - ", 1)
        if left and right:
            artist, title = clean(left, 60), clean(right, 80)

    dur = entry.get("duration")
    try:
        duration_sec = int(float(dur)) if dur is not None else 0
    except (TypeError, ValueError):
        duration_sec = 0

    # Prefer maxres (true 16:9) over hqdefault (4:3 with baked letterbox)
    url, blob, w, h, variant = pick_source(vid)
    if blob:
        try:
            thumb = build_cover(vid, blob)
            print(f"cover {vid} via {variant} {w}x{h} -> {thumb}", file=sys.stderr)
        except Exception as e:
            print(f"cover failed {vid}: {e}; using remote", file=sys.stderr)
            thumb = url or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    else:
        thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        print(f"cover missing source {vid}; remote hqdefault", file=sys.stderr)

    pub_id = hashlib.sha256(vid.encode("utf-8")).hexdigest()[:12]
    keep_ids.add(vid)
    tracks.append({
        "id": pub_id,
        "videoId": vid,
        "title": title,
        "artist": artist,
        "durationSec": max(0, duration_sec),
        "thumb": thumb,
    })
    if len(tracks) >= limit:
        break

# Drop stale cover files from previous syncs
for old in covers_dir.glob("*.jpg"):
    if old.stem not in keep_ids:
        old.unlink()

if len(tracks) > 30:
    print("Abort: more than 30 tracks", file=sys.stderr)
    sys.exit(1)

ids = ",".join(t["id"] for t in tracks)
manifest = hashlib.sha256(ids.encode("utf-8")).hexdigest()[:16] if tracks else "empty"
playlist_title = clean(data.get("title") or "Ankush's Mix", 80) or "Ankush's Mix"

out = {
    "version": 1,
    "title": playlist_title,
    "updated": date.today().isoformat(),
    "manifestHash": manifest,
    "tracks": tracks,
}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"Wrote {len(tracks)} tracks -> {out_path}", file=sys.stderr)
PY

# Gates: no audio binaries under static/music; catalog must not reference media files / googlevideo
if find "$ROOT/static/music" -type f \( -name '*.mp3' -o -name '*.m4a' -o -name '*.webm' -o -name '*.opus' -o -name '*.mp4' \) 2>/dev/null | grep -q .; then
  echo "Abort: audio/video binaries found under static/music" >&2
  exit 1
fi

if grep -Eiq 'googlevideo|\.mp3|\.m4a|\.webm|\.opus|youtube\.com/watch|youtu\.be/' "$OUT"; then
  echo "Abort: leakage gate failed on music.json (media URLs or watch links)" >&2
  exit 1
fi

echo "Done." >&2
