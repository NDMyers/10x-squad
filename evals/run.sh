#!/usr/bin/env bash
# 10x-squad eval runner.
#
#   ./run.sh <variant-label> [task-dir ...]     run suite (all tasks if none given)
#   DRY_RUN=1 ./run.sh smoke                    exercise plumbing, zero token spend
#
# Env:
#   REPS=3                  repetitions per task
#   CLAUDE_FLAGS="..."      extra flags for claude -p (e.g. --model claude-sonnet-5)
#   DRY_RUN=1               stub the model call with canned JSON
#
# Task contract (evals/tasks/<name>/):
#   prompt.md     required — the exact prompt sent headlessly
#   check.sh      required — exit 0 = pass; runs with cwd = workspace/ (or task dir)
#   reset.sh      optional — restore fixture state; runs before every rep
#   workspace/    optional — cwd for the claude run and check.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VARIANT="${1:?usage: run.sh <variant-label> [task-dir ...]}"
shift || true

REPS="${REPS:-3}"
CSV="$HERE/results.csv"
PROMPT_SHA="$(git -C "$HERE/.." rev-parse --short HEAD 2>/dev/null || echo "no-git")"

if [ "$#" -gt 0 ]; then TASKS=("$@"); else TASKS=("$HERE"/tasks/*/); fi
[ -f "$CSV" ] || echo "timestamp,variant,prompt_sha,task,rep,pass,cost_usd,duration_ms,num_turns" > "$CSV"

# Parse one field from claude's JSON result without a jq dependency.
jfield() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1], 0))' "$1"; }

for task_dir in "${TASKS[@]}"; do
  task_dir="${task_dir%/}"
  name="$(basename "$task_dir")"
  [ -f "$task_dir/prompt.md" ] || { echo "SKIP $name: no prompt.md" >&2; continue; }
  [ -x "$task_dir/check.sh" ] || { echo "SKIP $name: no executable check.sh" >&2; continue; }
  workdir="$task_dir"; [ -d "$task_dir/workspace" ] && workdir="$task_dir/workspace"

  for rep in $(seq 1 "$REPS"); do
    [ -x "$task_dir/reset.sh" ] && (cd "$task_dir" && ./reset.sh)
    stamp="$(date +%Y-%m-%dT%H:%M:%S)"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      out='{"total_cost_usd":0,"duration_ms":0,"num_turns":0,"result":"dry run"}'
      (cd "$workdir" && touch .dry-run-marker)   # lets smoke-task check.sh pass
    else
      # || true: a failed run is a data point (pass=0), not a suite abort.
      out="$(cd "$workdir" && claude -p "$(cat "$task_dir/prompt.md")" \
              --output-format json ${CLAUDE_FLAGS:-} 2>"$task_dir/last-stderr.log")" || true
    fi

    cost="$(printf '%s' "$out" | jfield total_cost_usd 2>/dev/null || echo 0)"
    dur="$(printf '%s'  "$out" | jfield duration_ms   2>/dev/null || echo 0)"
    turns="$(printf '%s' "$out" | jfield num_turns    2>/dev/null || echo 0)"

    if (cd "$workdir" && "$task_dir/check.sh" >/dev/null 2>&1); then pass=1; else pass=0; fi

    echo "$stamp,$VARIANT,$PROMPT_SHA,$name,$rep,$pass,$cost,$dur,$turns" >> "$CSV"
    echo "[$name rep$rep] pass=$pass cost=\$$cost turns=$turns"
  done
done

echo "done → $CSV"
