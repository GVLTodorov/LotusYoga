#!/usr/bin/env bash
# Usage: make-badges.sh <coverage-summary.json> <out-dir>
# Writes line.svg and branch.svg from a vitest/istanbul json-summary report.
set -euo pipefail
summary="$1"; out="$2"; mkdir -p "$out"

badge() { # label pct file
  local pct="$2" color="#e05d44"
  if awk "BEGIN{exit !($pct>=80)}"; then color="#4c1"
  elif awk "BEGIN{exit !($pct>=60)}"; then color="#dfb317"; fi
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20" role="img" aria-label="%s: %s%%"><rect width="100" height="20" fill="#555"/><rect x="100" width="50" height="20" fill="%s"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle"><text x="50" y="14">%s</text><text x="125" y="14">%s%%</text></g></svg>\n' \
    "$1" "$2" "$color" "$1" "$2" > "$3"
}

lines=$(node -p "require('./$summary').total.lines.pct")
branches=$(node -p "require('./$summary').total.branches.pct")
badge "line coverage" "$lines" "$out/line.svg"
badge "branch coverage" "$branches" "$out/branch.svg"
