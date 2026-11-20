#!/usr/bin/env bash
# Roll up target-harness results per variant and requested execution profile.
set -euo pipefail
CSV="${RESULTS_CSV:-$(cd "$(dirname "$0")" && pwd)/results.csv}"
[ -f "$CSV" ] || { echo "no results.csv yet"; exit 1; }

# Windows installs Python 3 as `python`; `python3` there is absent or a Store stub.
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c 'import sys; sys.exit(sys.version_info[0] != 3)' >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
[ -n "$PYTHON" ] || { echo "summarize.sh needs Python 3 on PATH" >&2; exit 1; }

"$PYTHON" - "$CSV" <<'EOF'
import csv
import sys
from collections import defaultdict
from statistics import median

rows = list(csv.DictReader(open(sys.argv[1], newline="")))
groups = defaultdict(lambda: defaultdict(list))

for row in rows:
    key = (
        row["variant"],
        row["harness"],
        row["requested_model"],
        row["requested_reasoning"],
    )
    groups[key][row["task"]].append(row)

def values(rows, field):
    return [float(row[field]) for row in rows if (row.get(field) or "") != ""]

def mean(rows, field):
    found = values(rows, field)
    return None if not found else sum(found) / len(found)

def med(rows, field):
    found = values(rows, field)
    return None if not found else median(found)

def spread(rows, field, digits=0):
    found = values(rows, field)
    if not found:
        return "n/a"
    return f"{min(found):.{digits}f}-{max(found):.{digits}f}"

def shown(value, digits=0):
    if value is None:
        return "n/a"
    return f"{value:.{digits}f}"

print(
    f"{'variant':<20}{'harness':<14}{'model':<20}{'effort':<9}"
    f"{'tasks':>6}{'pass@1':>9}{'pass^k':>9}{'ms':>9}{'in tok':>10}"
    f"{'calls':>8}{'subs':>7}{'$ mean':>9}"
)

for key, tasks in sorted(groups.items()):
    variant, harness, model, effort = key
    flat = [row for task_rows in tasks.values() for row in task_rows]
    pass_at_one = sum(any(int(row["pass"]) for row in task_rows) for task_rows in tasks.values()) / len(tasks)
    pass_all = sum(all(int(row["pass"]) for row in task_rows) for task_rows in tasks.values()) / len(tasks)
    print(
        f"{variant:<20}{harness:<14}{model:<20}{effort:<9}"
        f"{len(tasks):>6}{pass_at_one:>9.0%}{pass_all:>9.0%}"
        f"{shown(mean(flat, 'duration_ms')):>9}{shown(mean(flat, 'input_tokens')):>10}"
        f"{shown(mean(flat, 'model_calls'), 1):>8}{shown(mean(flat, 'subagent_calls'), 1):>7}"
        f"{shown(mean(flat, 'cost_usd'), 3):>9}"
    )

if any((row.get("credits") or "") != "" for row in rows):
    print()
    print("Cost and quality per task (credits are Copilot AI credits from usage records)")
    print(
        f"{'variant':<20}{'task':<22}{'n':>3}{'pass':>7}{'quality':>9}"
        f"{'credits med':>13}{'range':>17}{'surcharge':>11}{'peak ctx':>10}{'compact':>9}{'stopped':>9}"
    )
    for key, tasks in sorted(groups.items()):
        for task, task_rows in sorted(tasks.items()):
            passed = sum(int(row["pass"]) for row in task_rows)
            stopped = sum(1 for row in task_rows if (row.get("stopped_by") or "") != "")
            peak = max(values(task_rows, "peak_context_tokens") or [None])
            print(
                f"{key[0]:<20}{task:<22}{len(task_rows):>3}{f'{passed}/{len(task_rows)}':>7}"
                f"{shown(med(task_rows, 'quality'), 2):>9}"
                f"{shown(med(task_rows, 'credits'), 1):>13}{spread(task_rows, 'credits', 1):>17}"
                f"{shown(med(task_rows, 'surcharge_credits'), 1):>11}"
                f"{shown(peak, 0):>10}"
                f"{shown(med(task_rows, 'compactions'), 1):>9}{stopped:>9}"
            )
EOF
