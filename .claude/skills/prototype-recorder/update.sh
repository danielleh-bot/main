#!/usr/bin/env bash
# Pull the latest version of the skill and re-run setup if anything new is
# needed. Safe to run anytime — idempotent.
#
# Usage:
#   ~/.claude/skills/prototype-recorder/update.sh
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SKILL_DIR"

if [[ ! -d .git ]]; then
  echo "✗ Not a git checkout — was this skill installed via clone?"
  echo "  Re-clone: git clone <repo-url> $SKILL_DIR"
  exit 1
fi

echo "→ Pulling latest..."
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "✓ Already up to date"
else
  echo "→ Updated: $BEFORE → $AFTER"
  echo ""
  echo "Recent changes:"
  git log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'
  echo ""
  echo "→ Re-running setup in case deps changed..."
  "$SKILL_DIR/setup.sh" --install
fi
