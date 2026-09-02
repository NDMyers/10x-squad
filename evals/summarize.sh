#!/usr/bin/env bash
# Roll up target-harness results per variant and requested execution profile.
set -euo pipefail
CSV="${RESULTS_CSV:-$(cd "$(dirname "$0")" && pwd)/results.csv}"
[ -f "$CSV" ] || { echo "no results.csv yet"; exit 1; }

python3 - "$CSV" <<'EOF'
import csv
import sys
from collections import defaultdict

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

def mean(rows, field):
    values = [float(row[field]) for row in rows if row.get(field, "") != ""]
    return None if not values else sum(values) / len(values)

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
EOF
