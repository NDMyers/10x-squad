#!/usr/bin/env bash
set -euo pipefail

workdir="${1:?workdir required}"
prompt_file="${2:?prompt file required}"
events_file="${3:?events file required}"
model="${4:?model required}"

args=(
  -C "$workdir"
  --agent 10x-squad
  --prompt "$(cat "$prompt_file")"
  --output-format json
  --model "$model"
  --allow-all-tools
  --no-ask-user
  --no-auto-update
  --no-color
  --disable-builtin-mcps
)

if [[ -n "${EVAL_REASONING_EFFORT:-}" && "${EVAL_REASONING_EFFORT}" != "auto" ]]; then
  args+=(--reasoning-effort "$EVAL_REASONING_EFFORT")
fi

copilot "${args[@]}" > "$events_file"