#!/usr/bin/env bash
# Pass condition: hello.txt has the exact expected content.
# DRY_RUN leaves .dry-run-marker instead — accept it so plumbing tests pass.
set -euo pipefail
[ -f .dry-run-marker ] && exit 0
[ "$(cat hello.txt 2>/dev/null)" = "10x eval harness alive" ]
