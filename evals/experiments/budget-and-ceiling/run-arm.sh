#!/usr/bin/env bash
# Runs one arm of the budget-and-ceiling experiment through evals/run.sh.
#
#   run-arm.sh <baseline|budget|ceiling|both> [task-dir ...]
#
#   baseline   old squad (no budget, no no-progress stop), builder at long_context
#   budget     current squad, builder at long_context
#   ceiling    old squad, builder at the default (smaller) context tier
#   both       current squad, builder at the default context tier
#
# Env:
#   BASE_ROUTING        model-routing.json to start from (required unless DRY_RUN=1)
#   BASELINE_REF        commit of the old squad; default 421f715^ (just before bounded work orders)
#   CURRENT_REF         commit of the current squad; default HEAD
#   BUDGET_CALLS, BUDGET_MINUTES, BUDGET_NO_PROGRESS
#                       for the sweep: override the numbers in the current squad's prompts
#                       (any one set switches the arm to a modified copy and renames its variant)
#   ARM_LABEL           variant name written to the results CSV; default is the arm name
#   ARM_HARNESS_NAME    harness whose profile gets the builder's context tier; default copilot-cli
#   PREPARE_ONLY=1      build the squad copy and routing config, print what was set up, run nothing
#   KEEP_ARM_DIR=1      keep the temporary squad copies after the run
# Everything evals/run.sh reads (EVAL_HARNESS, EVAL_MODEL, REPS, RESULTS_CSV, RUNS_DIR,
# EVAL_MAX_SECONDS, EVAL_MAX_CREDITS, DRY_RUN) passes straight through.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
ARM="${1:?usage: run-arm.sh <baseline|budget|ceiling|both> [task-dir ...]}"
shift || true

case "$ARM" in
  baseline) SQUAD_REF="${BASELINE_REF:-421f715^}"; TIER=long_context; CURRENT=0 ;;
  budget)   SQUAD_REF="${CURRENT_REF:-HEAD}";      TIER=long_context; CURRENT=1 ;;
  ceiling)  SQUAD_REF="${BASELINE_REF:-421f715^}"; TIER=default;      CURRENT=0 ;;
  both)     SQUAD_REF="${CURRENT_REF:-HEAD}";      TIER=default;      CURRENT=1 ;;
  *) echo "arm must be baseline, budget, ceiling or both" >&2; exit 2 ;;
esac

OVERRIDE=0
if [[ -n "${BUDGET_CALLS:-}${BUDGET_MINUTES:-}${BUDGET_NO_PROGRESS:-}" ]]; then
  [[ "$CURRENT" = "1" ]] || { echo "budget numbers only apply to the budget and both arms" >&2; exit 2; }
  OVERRIDE=1
fi

ARM_DIR="${ARM_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/10x-arm.XXXXXX")}"
SQUAD_DIR="$ARM_DIR/squad"
cleanup() {
  if [[ "${KEEP_ARM_DIR:-0}" != "1" ]]; then
    git -C "$REPO" worktree remove --force "$SQUAD_DIR" >/dev/null 2>&1 || true
    rm -rf "$ARM_DIR"
  fi
}
trap cleanup EXIT HUP INT TERM

git -C "$REPO" worktree add --detach "$SQUAD_DIR" "$SQUAD_REF" >/dev/null 2>&1 \
  || { echo "could not check out $SQUAD_REF" >&2; exit 2; }

LABEL="${ARM_LABEL:-$ARM}"
if [[ "$OVERRIDE" = "1" ]]; then
  calls="${BUDGET_CALLS:-200}"; minutes="${BUDGET_MINUTES:-60}"; no_progress="${BUDGET_NO_PROGRESS:-10}"
  node "$HERE/apply-numbers.js" --squad-root "$SQUAD_DIR" --calls "$calls" --minutes "$minutes" --no-progress "$no_progress" >/dev/null
  [[ -n "${ARM_LABEL:-}" ]] || LABEL="$ARM-c$calls-m$minutes-n$no_progress"
fi

if [[ -n "${BASE_ROUTING:-}" ]]; then
  export EVAL_ROUTING_CONFIG="$ARM_DIR/model-routing.json"
  node "$HERE/arm-routing.js" --base "$BASE_ROUTING" --out "$EVAL_ROUTING_CONFIG" \
    --linus-context-tier "$TIER" --harness "${ARM_HARNESS_NAME:-copilot-cli}" >/dev/null
elif [[ "${DRY_RUN:-0}" != "1" ]]; then
  echo "BASE_ROUTING is required for real runs" >&2
  exit 2
fi

export EVAL_SQUAD_ROOT="$SQUAD_DIR"

if [[ "${PREPARE_ONLY:-0}" = "1" ]]; then
  echo "arm=$ARM label=$LABEL squad=$(git -C "$SQUAD_DIR" rev-parse --short HEAD) builder_context_tier=$TIER"
  if grep -q 'Bounded work orders' "$SQUAD_DIR/assets/vivaldi/core.md"; then
    echo "work orders: on ($(grep -o 'about [0-9]* calls or [0-9]* minutes' "$SQUAD_DIR/assets/vivaldi/core.md"); $(grep -o 'Stop after about [0-9]* calls in a row' "$SQUAD_DIR/assets/skills/10x-linus-build/SKILL.md"))"
  else
    echo "work orders: off"
  fi
  if [[ -n "${EVAL_ROUTING_CONFIG:-}" ]]; then
    node -e '
      const cfg = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const tiers = Object.values(cfg.harnesses[process.argv[2]].dispatch_settings.linus).map((s) => s.context_tier);
      console.log(`routing: schema ${cfg.schema_version}, linus context_tier = ${[...new Set(tiers)].join(",")}`);
    ' "$EVAL_ROUTING_CONFIG" "${ARM_HARNESS_NAME:-copilot-cli}"
  fi
  exit 0
fi

bash "$REPO/evals/run.sh" "$LABEL" "$@"
