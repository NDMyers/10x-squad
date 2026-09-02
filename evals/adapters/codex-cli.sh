#!/usr/bin/env bash
set -euo pipefail

workdir="${1:?workdir required}"
prompt_file="${2:?prompt file required}"
events_file="${3:?events file required}"
model="${4:?model required}"

prompt=$(printf 'Use $10x-squad-vivaldi to run this task through the 10x Squad pipeline.\n\n%s' "$(cat "$prompt_file")")
args=(exec -C "$workdir" --json --ephemeral --skip-git-repo-check --sandbox workspace-write --model "$model")

if [[ -n "${EVAL_REASONING_EFFORT:-}" && "${EVAL_REASONING_EFFORT}" != "auto" ]]; then
  args+=(-c "model_reasoning_effort=\"$EVAL_REASONING_EFFORT\"")
fi

codex "${args[@]}" "$prompt" > "$events_file"