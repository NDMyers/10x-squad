#!/usr/bin/env bash
# Roll up results.csv per variant: pass@1, pass^REPS, mean cost, mean turns.
set -euo pipefail
CSV="$(cd "$(dirname "$0")" && pwd)/results.csv"
[ -f "$CSV" ] || { echo "no results.csv yet"; exit 1; }

python3 - "$CSV" <<'EOF'
import csv, sys
from collections import defaultdict

rows = list(csv.DictReader(open(sys.argv[1])))
by_variant = defaultdict(lambda: defaultdict(list))   # variant -> task -> [pass,...]
cost = defaultdict(list); turns = defaultdict(list)

for r in rows:
    v, t = r["variant"], r["task"]
    by_variant[v][t].append(int(r["pass"]))
    cost[v].append(float(r["cost_usd"]));  turns[v].append(float(r["num_turns"]))

print(f"{'variant':<24}{'tasks':>6}{'pass@1':>9}{'pass^k':>9}{'$ mean':>9}{'turns':>7}")
for v, tasks in sorted(by_variant.items()):
    p1  = sum(any(p) for p in tasks.values()) / len(tasks)
    pk  = sum(all(p) for p in tasks.values()) / len(tasks)
    c   = sum(cost[v]) / len(cost[v])
    tn  = sum(turns[v]) / len(turns[v])
    print(f"{v:<24}{len(tasks):>6}{p1:>9.0%}{pk:>9.0%}{c:>9.3f}{tn:>7.1f}")
EOF
