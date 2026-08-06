#!/usr/bin/env bash
#
# export-review-package.sh — bundle the current Architecture Review Gate
# docs into a single ZIP for external review. Copies files as they exist
# on disk right now (no regeneration). Usage: ./scripts/export-review-package.sh
# (or: npm run export-review-package)

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from, so
# `./scripts/export-review-package.sh` and `npm run export-review-package`
# (which npm runs from the repo root anyway) both behave the same.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
OUT_DIR="$REPO_ROOT/dist"

mkdir -p "$OUT_DIR"

# Staging directory for the files we're about to zip — kept inside OUT_DIR
# (git-ignored) so a failed run never leaves stray files in docs/ or the
# repo root.
STAGE_DIR="$(mktemp -d)"
cleanup() { rm -rf "$STAGE_DIR"; }
trap cleanup EXIT

included=()
skipped=()
# Tracks basenames already copied into the stage dir so a file matching
# more than one pattern (e.g. SPRINT_3_DESIGN_REVIEW.md matches both
# SPRINT_*_DESIGN_REVIEW.md and the broader SPRINT_*_REVIEW.md glob) is
# only bundled and reported once, not duplicated.
declare -A seen

# add_file <path-relative-to-docs-dir>
add_file() {
  local rel="$1"
  local src="$DOCS_DIR/$rel"
  local base
  base="$(basename "$rel")"
  if [ -n "${seen[$base]:-}" ]; then
    return
  fi
  if [ -f "$src" ]; then
    cp "$src" "$STAGE_DIR/$base"
    included+=("$rel")
    seen[$base]=1
  else
    skipped+=("$rel")
    echo "WARNING: $rel not found — skipping" >&2
  fi
}

# add_glob <glob-pattern-relative-to-docs-dir>
# Skips gracefully (no warning-as-error) if the glob matches nothing.
add_glob() {
  local pattern="$1"
  local matched=0
  shopt -s nullglob
  for src in "$DOCS_DIR"/$pattern; do
    matched=1
    local rel="${src#"$DOCS_DIR"/}"
    local base
    base="$(basename "$rel")"
    if [ -n "${seen[$base]:-}" ]; then
      continue
    fi
    cp "$src" "$STAGE_DIR/$base"
    included+=("$rel")
    seen[$base]=1
  done
  shopt -u nullglob
  if [ "$matched" -eq 0 ]; then
    skipped+=("$pattern")
    echo "WARNING: no files matched '$pattern' — skipping" >&2
  fi
}

add_file "MASTER_BLUEPRINT.md"
add_file "ARCHITECTURE_DECISIONS.md"
add_glob "SPRINT_*_DESIGN_REVIEW.md"
add_glob "SPRINT_*_REVIEW.md"
add_file "VISION_GUARDRAILS.md"
add_file "MISSION_ENGINE.md"

if [ "${#included[@]}" -eq 0 ]; then
  echo "ERROR: nothing to package — no expected files were found in $DOCS_DIR" >&2
  exit 1
fi

# Infer a sprint number for the filename from the highest-numbered
# SPRINT_<N>_*.md file we actually found, so the package name reflects
# what's inside it. Falls back to a plain date-stamped name if no
# sprint-numbered file was included (e.g. only MASTER_BLUEPRINT.md exists).
sprint_num=""
for f in "${included[@]}"; do
  if [[ "$f" =~ ^SPRINT_([0-9]+)_ ]]; then
    n="${BASH_REMATCH[1]}"
    if [ -z "$sprint_num" ] || [ "$n" -gt "$sprint_num" ]; then
      sprint_num="$n"
    fi
  fi
done

date_stamp="$(date +%Y-%m-%d)"
if [ -n "$sprint_num" ]; then
  zip_name="review-package-sprint${sprint_num}-${date_stamp}.zip"
else
  zip_name="review-package-${date_stamp}.zip"
fi
zip_path="$OUT_DIR/$zip_name"

# Build the zip in a scratch temp location first, then copy (not move) it
# into place. Some filesystems (notably networked/mounted output folders)
# block renaming over an existing file even when they allow ordinary
# writes; building elsewhere and copying in sidesteps that entirely and
# works identically everywhere else.
tmp_zip="$(mktemp -u "${TMPDIR:-/tmp}/review-package-XXXXXX.zip")"
( cd "$STAGE_DIR" && zip -q -r "$tmp_zip" . )
cp "$tmp_zip" "$zip_path"
rm -f "$tmp_zip" || true

echo ""
echo "Review package: $zip_path"
echo ""
echo "Included (${#included[@]}):"
for f in "${included[@]}"; do
  echo "  - $f"
done
echo ""
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "Skipped (${#skipped[@]}):"
  for f in "${skipped[@]}"; do
    echo "  - $f"
  done
else
  echo "Skipped: none"
fi
