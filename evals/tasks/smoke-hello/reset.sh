#!/usr/bin/env bash
# Restore fixture to pristine state before each rep.
set -euo pipefail
cd "$(dirname "$0")/workspace"
rm -f hello.txt .dry-run-marker
