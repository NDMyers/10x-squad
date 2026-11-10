#!/usr/bin/env bash
set -euo pipefail

workdir="${1:?workdir required}"
prompt_file="${2:?prompt file required}"
events_file="${3:?events file required}"
model="${4:?model required}"

# /10x-squad is a skill (disable-model-invocation), so it runs only when named.
prompt=$(printf '/10x-squad %s' "$(cat "$prompt_file")")

# stream-json (+ --verbose, which -p requires for it) carries every main-thread
# and subagent turn with message.model, which is how executed child models are
# verified (docs/claude-code-harness-spike.md, C4). The eval workdir is a
# disposable copy, so permissions are bypassed the same way the other adapters
# grant all tools; nothing outside the workdir is touched by the task.
args=(-p "$prompt" --output-format stream-json --verbose --model "$model"
  --no-session-persistence --permission-mode bypassPermissions)

if [[ -n "${EVAL_REASONING_EFFORT:-}" && "${EVAL_REASONING_EFFORT}" != "auto" ]]; then
  args+=(--effort "$EVAL_REASONING_EFFORT")
fi

if [[ -n "${EVAL_MAX_BUDGET_USD:-}" ]]; then
  args+=(--max-budget-usd "$EVAL_MAX_BUDGET_USD")
fi

# Clear Claude Code's surface signals so a run started from inside another
# Claude Code session (desktop app, IDE) detects itself as claude-cli
# (sdk-cli) instead of inheriting the parent's entrypoint.
(cd "$workdir" && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude "${args[@]}" < /dev/null) > "$events_file"
