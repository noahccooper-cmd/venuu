#!/bin/sh
# Local validation of 00077 → 00078 → 00079 against the prod snapshot in
# PGlite (embedded Postgres 17, no Docker). PGlite is installed into a temp
# folder and symlinked here (gitignored) — it is NOT a project dependency.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="${TMPDIR:-/tmp}/venuu-pglite"
mkdir -p "$TMP"
[ -d "$TMP/node_modules/@electric-sql/pglite" ] || (cd "$TMP" && npm init -y >/dev/null && npm install @electric-sql/pglite@0.3 --no-audit --no-fund >/dev/null)
ln -sfn "$TMP/node_modules" "$HERE/node_modules"
cd "$HERE" && node validate.mjs 2>&1 | awk 'length($0) < 600' | grep -E '^(PASS|FAIL|HARNESS)|passed|profiles-dependent'
