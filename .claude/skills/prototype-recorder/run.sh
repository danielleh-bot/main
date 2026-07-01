#!/usr/bin/env bash
# End-to-end orchestrator: Playwright record → mp4 archive + gif delivery
# Saves into ~/Desktop/prototype-recordings/<name>/{gifs,recordings}/
#
# Usage:
#   run.sh --name <trigger> --url <url>
#          [--preset smooth-small|high-quality|tiny]
#          [--device "iPhone 14 Pro"]
#          [--duration 15000]
#          [--interaction scroll | --click <sel> | --js-file <path>]
#          [--out-dir <dir>]
set -euo pipefail

NAME=""
URL=""
PRESET="smooth-small"
DEVICE="iPhone 14 Pro"
VIEWPORT=""
DURATION="15000"
INTERACTION_TYPE=""
INTERACTION_VALUE=""
OUT_DIR="$HOME/Desktop/prototype-recordings"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)        NAME="$2"; shift 2 ;;
    --url)         URL="$2"; shift 2 ;;
    --preset)      PRESET="$2"; shift 2 ;;
    --device)      DEVICE="$2"; shift 2 ;;
    --viewport)    VIEWPORT="$2"; shift 2 ;;
    --duration)    DURATION="$2"; shift 2 ;;
    --interaction) INTERACTION_TYPE="interaction"; INTERACTION_VALUE="$2"; shift 2 ;;
    --click)       INTERACTION_TYPE="click"; INTERACTION_VALUE="$2"; shift 2 ;;
    --js-file)     INTERACTION_TYPE="js-file"; INTERACTION_VALUE="$2"; shift 2 ;;
    --out-dir)     OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Default desktop viewport bump — Playwright's "Desktop Chrome" default is
# 1280×720 which is cramped for modern UIs. Default to 1440×900 unless the
# caller passed an explicit --viewport.
if [[ -z "$VIEWPORT" && "$DEVICE" == "Desktop Chrome" ]]; then
  VIEWPORT="1440x900"
fi

if [[ -z "$NAME" || -z "$URL" ]]; then
  echo "Usage: run.sh --name <trigger> --url <url> [--preset ...] [--js-file ...]"
  exit 1
fi

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Dependency gate (idempotent, ~50ms when everything's installed)
if ! "$SKILL_DIR/setup.sh"; then
  echo ""
  echo "✗ Cannot record until dependencies are installed."
  echo "  Fix: $SKILL_DIR/setup.sh --install"
  exit 1
fi
TS=$(date +%Y%m%d-%H%M%S)
TRIGGER_DIR="$OUT_DIR/$NAME"
GIF_DIR="$TRIGGER_DIR/gifs"
REC_DIR="$TRIGGER_DIR/recordings"
WORK_DIR=$(mktemp -d -t prototype-recorder-XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$GIF_DIR" "$REC_DIR"

INTER_ARGS=()
case "$INTERACTION_TYPE" in
  interaction) INTER_ARGS=(--interaction "$INTERACTION_VALUE") ;;
  click)       INTER_ARGS=(--click "$INTERACTION_VALUE") ;;
  js-file)     INTER_ARGS=(--js-file "$INTERACTION_VALUE") ;;
esac

VIEWPORT_ARGS=()
if [[ -n "$VIEWPORT" ]]; then
  VIEWPORT_ARGS=(--viewport "$VIEWPORT")
fi

echo "→ Recording (work dir: $WORK_DIR)"
node "$SKILL_DIR/record.mjs" \
  --url "$URL" \
  --out "$WORK_DIR" \
  --device "$DEVICE" \
  --duration "$DURATION" \
  ${VIEWPORT_ARGS[@]+"${VIEWPORT_ARGS[@]}"} \
  ${INTER_ARGS[@]+"${INTER_ARGS[@]}"}

WEBM="$WORK_DIR/recording.webm"
if [[ ! -f "$WEBM" ]]; then
  echo "✗ No webm produced"
  exit 1
fi

MP4="$REC_DIR/${NAME}-${TS}.mp4"
echo "→ Archiving as mp4 → $MP4"
ffmpeg -i "$WEBM" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -y -loglevel error "$MP4"
MP4_SIZE=$(du -h "$MP4" | cut -f1)
echo "✓ MP4 → $MP4 (${MP4_SIZE})"

# Also copy load.json next to mp4 for the converter (so re-runs work)
cp "$WORK_DIR/load.json" "$REC_DIR/${NAME}-${TS}.load.json" 2>/dev/null || true

GIF="$GIF_DIR/${NAME}-${PRESET}-${TS}.gif"
"$SKILL_DIR/convert.sh" "$WEBM" "$GIF" "$PRESET"

echo ""
echo "── Outputs ──"
echo "  GIF (for slides): $GIF"
echo "  MP4 (archive):    $MP4"
