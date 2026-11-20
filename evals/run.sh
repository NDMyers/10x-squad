#!/usr/bin/env bash
# 10x-squad target-harness eval runner.
#
#   ./run.sh <variant-label> [task-dir ...]     run suite (all tasks if none given)
#   DRY_RUN=1 ./run.sh smoke                    exercise plumbing, zero token spend
#
# Env:
#   REPS=3                  repetitions per task
#   EVAL_HARNESS             copilot-cli | codex-cli | claude-cli | antigravity-cli (required for real runs)
#   EVAL_MODEL               exact model identifier for the selected harness
#   EVAL_ROUTING_CONFIG      model-routing.json with the selected harness profile
#   EVAL_REASONING_EFFORT    optional explicit effort; default auto
#   RESULTS_CSV              output CSV path; default evals/results.csv
#   RUNS_DIR                 raw event root; default evals/runs
#   EVAL_SQUAD_ROOT          squad checkout to install from; default this repo (lets one arm run an older commit)
#   EVAL_MAX_SECONDS         optional wall-clock cap per run; the run is stopped and recorded as stopped_by=wall_clock
#   EVAL_MAX_CREDITS         optional credit cap per run (Copilot usage records); recorded as stopped_by=credits
#   DRY_RUN=1               stub the model call with canned JSON
#   DRY_RUN_EVENTS_FILE      with DRY_RUN, a recorded events file to normalize instead of an empty one
#
# Task contract (evals/tasks/<name>/):
#   prompt.md     required — the exact prompt sent headlessly
#   check.sh      required — exit 0 = pass; runs with cwd = workspace/ (or task dir).
#                 It may print a line `QUALITY=<0..1>` (for example the fraction of hidden tests passed);
#                 the last such line is recorded in the quality column.
#   reset.sh      optional — restore fixture state; runs before every rep
#   workspace/    optional — cwd for the claude run and check.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VARIANT="${1:?usage: run.sh <variant-label> [task-dir ...]}"
shift || true

REPS="${REPS:-3}"
HARNESS="${EVAL_HARNESS:-}"
CSV="${RESULTS_CSV:-$HERE/results.csv}"
RUNS_DIR="${RUNS_DIR:-$HERE/runs}"
REASONING="${EVAL_REASONING_EFFORT:-auto}"
SQUAD_ROOT="${EVAL_SQUAD_ROOT:-$HERE/..}"
PROMPT_SHA="$(git -C "$SQUAD_ROOT" rev-parse --short HEAD 2>/dev/null || echo "no-git")"
RUN_ID="$(node -e 'process.stdout.write(`${Date.now()}-${process.pid}`)')"
VARIANT_ID="$(node -e 'const crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.argv[1]).digest("hex").slice(0, 16));' "$VARIANT")"

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  case "$HARNESS" in
    copilot-cli|codex-cli|claude-cli|antigravity-cli) ;;
    *) echo "EVAL_HARNESS must be copilot-cli, codex-cli, claude-cli, or antigravity-cli" >&2; exit 2 ;;
  esac
  MODEL="${EVAL_MODEL:?EVAL_MODEL is required for real runs}"
  ROUTING_CONFIG="${EVAL_ROUTING_CONFIG:?EVAL_ROUTING_CONFIG is required for real runs}"
  [[ -f "$ROUTING_CONFIG" ]] || { echo "EVAL_ROUTING_CONFIG is not a file: $ROUTING_CONFIG" >&2; exit 2; }
else
  HARNESS="${HARNESS:-dry-run}"
  MODEL="dry-run"
fi

if [ "$#" -gt 0 ]; then TASKS=("$@"); else TASKS=("$HERE"/tasks/*/); fi
for ((left_index = 0; left_index < ${#TASKS[@]}; left_index += 1)); do
  left_name="$(basename "${TASKS[$left_index]%/}")"
  for ((right_index = left_index + 1; right_index < ${#TASKS[@]}; right_index += 1)); do
    right_name="$(basename "${TASKS[$right_index]%/}")"
    if [[ "$left_name" = "$right_name" ]]; then
      echo "duplicate eval task name: $left_name" >&2
      exit 2
    fi
  done
done
mkdir -p "$(dirname "$CSV")" "$RUNS_DIR"
CSV_LOCK="$CSV.lock"
if ! mkdir "$CSV_LOCK" 2>/dev/null; then
  echo "results CSV is already in use: $CSV" >&2
  exit 2
fi
release_csv_lock() { rmdir "$CSV_LOCK" 2>/dev/null || true; }
trap release_csv_lock EXIT HUP INT TERM
node "$HERE/result-csv.js" init "$CSV"

json_field() {
  node -e 'const value=JSON.parse(process.argv[1])[process.argv[2]]; process.stdout.write(value == null ? "" : Array.isArray(value) ? value.join(";") : String(value));' "$1" "$2"
}

for task_dir in "${TASKS[@]}"; do
  task_dir="${task_dir%/}"
  # Absolute, because the check runs from inside the task's workspace: a
  # relative task path (evals/tasks/x) would no longer resolve there.
  [ -d "$task_dir" ] && task_dir="$(cd "$task_dir" && pwd)"
  name="$(basename "$task_dir")"
  [ -f "$task_dir/prompt.md" ] || { echo "SKIP $name: no prompt.md" >&2; continue; }
  [ -x "$task_dir/check.sh" ] || { echo "SKIP $name: no executable check.sh" >&2; continue; }
  workdir="$task_dir"; [ -d "$task_dir/workspace" ] && workdir="$task_dir/workspace"

  for rep in $(seq 1 "$REPS"); do
    [ -x "$task_dir/reset.sh" ] && (cd "$task_dir" && ./reset.sh)
    stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    run_dir="$RUNS_DIR/$VARIANT_ID/$name/$RUN_ID-rep-$rep"
    mkdir -p "$run_dir"
    events="$run_dir/events.jsonl"
    stderr_log="$run_dir/stderr.log"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      if [[ -n "${DRY_RUN_EVENTS_FILE:-}" ]]; then
        cp "$DRY_RUN_EVENTS_FILE" "$events"
      else
        : > "$events"
      fi
      : > "$stderr_log"
      (cd "$workdir" && touch .dry-run-marker)
      agent_exit=0
      duration=0
      started=""
      finished=""
    else
      install_harness="${HARNESS%-cli}"
      node "$SQUAD_ROOT/bin/10x-squad.js" install --directory "$workdir" --harness "$install_harness" >/dev/null
      mkdir -p "$workdir/.10x-squad"
      cp "$ROUTING_CONFIG" "$workdir/.10x-squad/model-routing.json"
      started=$(node -e 'process.stdout.write(String(Date.now()))')
      set +e
      if [[ -n "${EVAL_MAX_SECONDS:-}" || -n "${EVAL_MAX_CREDITS:-}" ]]; then
        guard_args=(--events "$events" --workdir "$workdir" --marker "$run_dir/stopped-by.json")
        [[ -n "${EVAL_MAX_SECONDS:-}" ]] && guard_args+=(--max-seconds "$EVAL_MAX_SECONDS")
        [[ -n "${EVAL_MAX_CREDITS:-}" ]] && guard_args+=(--max-credits "$EVAL_MAX_CREDITS")
        node "$HERE/guarded-run.js" "${guard_args[@]}" -- \
          bash "$HERE/adapters/$HARNESS.sh" "$workdir" "$task_dir/prompt.md" "$events" "$MODEL" 2>"$stderr_log"
      else
        bash "$HERE/adapters/$HARNESS.sh" "$workdir" "$task_dir/prompt.md" "$events" "$MODEL" 2>"$stderr_log"
      fi
      agent_exit=$?
      set -e
      finished=$(node -e 'process.stdout.write(String(Date.now()))')
      duration=$((finished - started))
    fi

    metrics=$(node "$HERE/normalize-events.js" \
      --events "$events" --harness "$HARNESS" --model "$MODEL" \
      --duration-ms "$duration" --exit-code "$agent_exit")

    observed=$(json_field "$metrics" observed_models)
    input=$(json_field "$metrics" input_tokens)
    cached=$(json_field "$metrics" cached_input_tokens)
    output=$(json_field "$metrics" output_tokens)
    model_calls=$(json_field "$metrics" model_calls)
    subagent_calls=$(json_field "$metrics" subagent_calls)
    tool_calls=$(json_field "$metrics" tool_calls)
    cost_usd=$(json_field "$metrics" cost_usd)
    parse_errors=$(json_field "$metrics" event_parse_errors)
    relative_events="${events#$HERE/}"

    cost_args=(--events "$events" --workdir "$workdir")
    [[ -n "$started" ]] && cost_args+=(--started-ms "$started" --finished-ms "$finished")
    cost_cols=$(node "$HERE/cost-columns.js" "${cost_args[@]}")
    credits=$(json_field "$cost_cols" credits)
    credits_by_persona=$(json_field "$cost_cols" credits_by_persona)
    peak_context=$(json_field "$cost_cols" peak_context_tokens)
    surcharge=$(json_field "$cost_cols" surcharge_credits)
    compactions=$(json_field "$cost_cols" compactions)
    follow_ups=$(json_field "$cost_cols" follow_ups)
    cost_source=$(json_field "$cost_cols" cost_source)
    stopped_by=""
    if [[ -f "$run_dir/stopped-by.json" ]]; then stopped_by=$(json_field "$(cat "$run_dir/stopped-by.json")" stopped_by); fi

    # Save the final diff of a task repo that is its own git repository, before check.sh copies hidden tests in.
    if [[ "$(git -C "$workdir" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$workdir" && pwd -P)" ]]; then
      git -C "$workdir" add -A -N . >/dev/null 2>&1 || true
      git -C "$workdir" diff -- . ':(exclude).10x-squad' ':(exclude).github' ':(exclude).claude' ':(exclude).agents' > "$run_dir/final.patch" 2>/dev/null || true
    fi

    if check_output="$(cd "$workdir" && "$task_dir/check.sh" 2>&1)"; then check_pass=1; else check_pass=0; fi
    quality="$(printf '%s\n' "$check_output" | sed -n 's/^QUALITY=\([0-9.]*\)$/\1/p' | tail -n 1)"

    if [[ "$check_pass" = "1" && "$agent_exit" = "0" && "$parse_errors" = "0" ]]; then pass=1; else pass=0; fi

    node "$HERE/result-csv.js" append "$CSV" \
      "$stamp" "$VARIANT" "$PROMPT_SHA" "$HARNESS" "$MODEL" "$REASONING" \
      "$observed" "$name" "$rep" "$pass" "$agent_exit" "$input" "$cached" \
      "$output" "$duration" "$model_calls" "$subagent_calls" "$tool_calls" \
      "$cost_usd" "$parse_errors" \
      "$credits" "$credits_by_persona" "$peak_context" "$surcharge" "$compactions" \
      "$follow_ups" "$cost_source" "$quality" "$stopped_by" "$relative_events"
    echo "[$name rep$rep] pass=$pass agent_exit=$agent_exit duration_ms=$duration input_tokens=${input:-unreported}"
  done
done

echo "done → $CSV"
