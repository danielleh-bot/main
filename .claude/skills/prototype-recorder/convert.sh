#!/usr/bin/env bash
# Convert a Playwright .webm recording to a polished GIF.
# Usage: convert.sh <input.webm> <output.gif> <preset: smooth-small|high-quality|tiny>
set -euo pipefail

INPUT=${1:?input webm required}
OUTPUT=${2:?output gif path required}
PRESET=${3:-smooth-small}

SRC_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$INPUT")
SRC_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$INPUT")

case "$PRESET" in
  tiny)         FPS=10; WIDTH=480;  QUAL=70  ;;
  smooth-small) FPS=15; WIDTH=720;  QUAL=80  ;;
  high-quality) FPS=30; WIDTH=1080; QUAL=100 ;;
  ultra)
    # Maximum sharpness preset: 60fps, near-source resolution (capped at 1920
    # so files don't become unmanageable), gifski quality 100. Expect 30-150MB
    # for ~12s clips. Use when sharpness matters more than file size.
    FPS=60; QUAL=100
    if [[ "$SRC_W" -gt 1920 ]]; then WIDTH=1920; else WIDTH=$SRC_W; fi
    ;;
  *) echo "Unknown preset: $PRESET (expected tiny|smooth-small|high-quality|ultra)"; exit 1 ;;
esac

# Detect aspect ratio. Landscape (desktop) sources need a wider gif than
# portrait (mobile) to keep text legible — the same target width that
# produces a 720×1559 mobile gif produces a 720×405 desktop gif, where
# every glyph is half the pixel height. Bump the width one tier for landscape.
# Ultra is exempt — it already uses source-relative width.
if [[ "$SRC_W" -gt "$SRC_H" ]]; then
  case "$PRESET" in
    tiny)         WIDTH=1080 ;;  # was 480 → 720 → 1080
    smooth-small) WIDTH=1440 ;;  # was 720 → 1080 → 1440 (matches typical desktop viewport)
    high-quality) WIDTH=1920 ;;  # was 1080 → 1440 → 1920 (full HD)
  esac
  if [[ "$PRESET" != "ultra" ]]; then
    echo "→ Landscape source detected (${SRC_W}×${SRC_H}); target gif width ${WIDTH}px"
  fi
fi

# Never upscale — if the recorded source is narrower than the preset target,
# clamp to source. Upscaling a gif blurs text without adding any real detail.
if [[ "$WIDTH" -gt "$SRC_W" ]]; then
  echo "→ Source narrower than target (${SRC_W} < ${WIDTH}); clamping gif width to ${SRC_W}"
  WIDTH=$SRC_W
fi

# Trim away page-load whitespace using load.json sibling, fallback 1500ms
LOADJSON="$(dirname "$INPUT")/load.json"
TRIM_MS=1500
if [[ -f "$LOADJSON" ]]; then
  if command -v jq >/dev/null 2>&1; then
    TRIM_MS=$(jq '.loadedAtMs // 1500' "$LOADJSON")
  else
    TRIM_MS=$(grep -o '"loadedAtMs"[^,}]*' "$LOADJSON" | grep -o '[0-9]*' | head -1)
    TRIM_MS=${TRIM_MS:-1500}
  fi
fi
TRIM_S=$(awk "BEGIN{printf \"%.3f\", $TRIM_MS/1000}")
echo "→ Trimming first ${TRIM_S}s (page load)"

mkdir -p "$(dirname "$OUTPUT")"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "→ Extracting frames at ${FPS}fps, width ${WIDTH}px..."
ffmpeg -ss "$TRIM_S" -i "$INPUT" \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -y -loglevel error \
  "$TMPDIR/frame%05d.png"

FRAME_COUNT=$(ls "$TMPDIR"/frame*.png 2>/dev/null | wc -l | tr -d ' ')
if [[ "$FRAME_COUNT" -eq 0 ]]; then
  echo "✗ No frames extracted — recording may be shorter than trim window."
  exit 1
fi
echo "→ Encoding ${FRAME_COUNT} frames with gifski (quality ${QUAL})..."

gifski \
  --output "$OUTPUT" \
  --fps "$FPS" \
  --width "$WIDTH" \
  --quality "$QUAL" \
  --quiet \
  "$TMPDIR"/frame*.png

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "✓ GIF → $OUTPUT (${SIZE})"
