#!/usr/bin/env bash
# Writes the DEMO.md text dumps: runs the plugin tests and splits the
# `@@DUMP <name>` ... `@@END` blocks tests/demo.test.ts prints into
# demo/<target>/<name>.txt. Usage: scripts/demo-dump.sh before|after
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-}"
case "$target" in
  before|after) ;;
  *) echo "usage: $0 before|after" >&2; exit 2 ;;
esac

mkdir -p "demo/$target"
out=$(command claude plugin test "$PWD" 2>&1) || true
printf '%s\n' "$out" | awk -v dir="demo/$target" '
  /^@@DUMP / { name = $2; file = dir "/" name ".txt"; printf "" > file; open = 1; next }
  /^@@END$/ { close(file); open = 0; next }
  open { print > file }
'
ls -1 "demo/$target"
printf '%s\n' "$out" | grep -E '^ *[0-9]+ (pass|fail)$' || true
