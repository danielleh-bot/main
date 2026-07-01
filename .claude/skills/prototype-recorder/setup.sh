#!/usr/bin/env bash
# First-run dependency check. Idempotent — finishes in ~50ms when everything
# is installed. Returns 0 on success; prints what's missing on failure.
#
# Usage:
#   setup.sh             # check only, fail with instructions if anything missing
#   setup.sh --install   # install anything missing (asks for confirmation per tool)
set -euo pipefail

INSTALL=false
if [[ "${1:-}" == "--install" ]]; then
  INSTALL=true
fi

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MISSING=()

# --- Gentle Homebrew guidance (for non-technical users) ---
# Called when brew is missing and we're in --install mode. Opens brew.sh in
# the user's browser, prints a friendly numbered walkthrough, and stops.
# Does NOT auto-run the curl installer — that's a "type your password" moment
# that should never surprise someone.
guide_brew_install() {
  cat <<'EOF'

  ──────────────────────────────────────────────────────────────
  📦 We need to install Homebrew first (one-time, ~5 min)
  ──────────────────────────────────────────────────────────────

  Homebrew is a free, well-known tool for installing other apps on a Mac.
  It's safe and used by millions of developers — don't worry, you're not
  doing anything risky.

  I'll open https://brew.sh in your browser now. Then:

     1. On that page, find the big black box near the top.
     2. Click the "copy" icon next to the command inside it.
     3. Come back to Terminal, paste with ⌘V, and press Enter.
     4. If it asks for your Mac password — type it and press Enter.
        ⚠️  The password dots WON'T appear as you type. That's normal!
            Just type it carefully and hit Enter.
     5. Wait ~5 minutes (it downloads things in the background).
     6. When it's done, come back here and run this again:

            ~/.claude/skills/prototype-recorder/setup.sh --install

  Opening brew.sh in your browser now…

EOF
  # Try to open the page (macOS); silently no-op if `open` isn't available.
  command -v open >/dev/null 2>&1 && open "https://brew.sh" 2>/dev/null || true
  exit 1
}

# --- Homebrew tools ---
need_brew_tool() {
  local tool=$1
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING+=("$tool (brew)")
    if $INSTALL; then
      if ! command -v brew >/dev/null 2>&1; then
        guide_brew_install
      fi
      echo "→ Installing $tool via brew..."
      brew install "$tool"
    fi
  fi
}

need_brew_tool ffmpeg
need_brew_tool gifski

# --- Node.js (required for Playwright + npm install) ---
if ! command -v node >/dev/null 2>&1; then
  MISSING+=("node")
  if $INSTALL; then
    if ! command -v brew >/dev/null 2>&1; then
      guide_brew_install
    fi
    echo "→ Installing node via brew..."
    brew install node
  fi
fi

# --- Playwright (npm) ---
if [[ ! -d "$SKILL_DIR/node_modules/playwright" ]]; then
  MISSING+=("playwright (npm)")
  if $INSTALL; then
    echo "→ Installing playwright npm package..."
    (cd "$SKILL_DIR" && npm install --silent)
  fi
fi

# --- Playwright Chromium browser ---
# Playwright caches browsers in ~/Library/Caches/ms-playwright on macOS.
# Detect by looking for any chromium_headless_shell-* directory.
PW_CACHE="$HOME/Library/Caches/ms-playwright"
if ! ls "$PW_CACHE"/chromium_headless_shell-* >/dev/null 2>&1; then
  MISSING+=("playwright-chromium")
  if $INSTALL; then
    echo "→ Installing Playwright chromium browser (~150MB, takes 1-2 min)..."
    (cd "$SKILL_DIR" && npx playwright install chromium)
  fi
fi

# --- Report ---
if [[ ${#MISSING[@]} -eq 0 ]]; then
  echo "✓ All dependencies installed"
  exit 0
fi

if $INSTALL; then
  # If we just installed, re-run check to confirm
  exec "$SKILL_DIR/setup.sh"
fi

echo "✗ Missing dependencies:"
for m in "${MISSING[@]}"; do
  echo "    - $m"
done
echo ""
echo "Run with --install to fix: $SKILL_DIR/setup.sh --install"
exit 1
