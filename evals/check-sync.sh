#!/usr/bin/env bash
# 10x-squad deployment parity & manifest check (finding F1/F7 alarm).
# Exit code = total failure count across all categories. 0 = fully in sync.
#
# Categories (different problems, different owners):
#   SOURCE    source-of-truth invariant: live deploy == installer assets,
#             and installer manifest covers every live skill. Must be 0 always.
#   UPSTREAM  corpay-agents copies lag the live lineage. Fixed by PR-ing the
#             company repo — Nick's call, not a local script's.
#   PORT      Claude Code command stubs reference skill paths that don't
#             resolve. Fixed by the installer's Claude target (ladder step 4).
#
# Canonical layout: this repo checked out inside the deploy workspace
# (<workspace>/10x-squad). Set SQUAD_ROOT if your workspace lives elsewhere.
MODE="${1:-all}"
case "$MODE" in
  all) ;;
  --source-only) ;;
  *) printf 'usage: %s [--source-only]\n' "$0" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
ROOT="${SQUAD_ROOT:-$(dirname "$REPO")}"
LIVE_SKILLS="$ROOT/.github/skills"
LIVE_AGENT="$ROOT/.github/agents/10x-squad.agent.md"
UPSTREAM="$ROOT/corpay-agents/.github"
CLAUDE_CMDS="${CLAUDE_CMDS:-$HOME/.claude/commands}"
set -uo pipefail

src_fail=0; up_fail=0; port_fail=0
ok()   { printf '  ✓ %s\n' "$*"; }
srcbad() { printf "  ✗ [SOURCE]   %s\n" "$*"; src_fail=$((src_fail+1)); }
upbad() { printf '  ~ [UPSTREAM] %s\n' "$*"; up_fail=$((up_fail+1)); }
ptbad() { printf '  ✗ [PORT]     %s\n' "$*"; port_fail=$((port_fail+1)); }

sum() { md5 -q "$1" 2>/dev/null || md5sum "$1" 2>/dev/null | awk '{print $1}' || echo MISSING; }

echo "== 1. Source-of-truth invariant: live deploy == installer assets"
if ! manifest_results=$(node - "$REPO" "$ROOT" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [repo, root] = process.argv.slice(2);
const installer = require(path.join(repo, 'lib', 'installer.js'));
const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');
const expectedAssets = installer.assetsFor('all');
const expectedTargets = new Set(expectedAssets.map((asset) => path.normalize(asset.target)));

for (const asset of expectedAssets) {
  const expected = asset.contents ? Buffer.from(asset.contents()) : fs.readFileSync(asset.source);
  const target = path.join(root, asset.target);
  let state = 'missing';
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      state = 'not_regular';
    } else {
      state = digest(fs.readFileSync(target)) === digest(expected) ? 'current' : 'drifted';
    }
  }
  process.stdout.write(`${asset.target}\t${state}\n`);
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

const discovered = new Set();
for (const discoveryRoot of installer.SKILL_DISCOVERY_ROOTS) {
  const absoluteRoot = path.join(root, discoveryRoot);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('10x-')) continue;
    for (const file of walkFiles(path.join(absoluteRoot, entry.name))) {
      discovered.add(path.relative(root, file));
    }
  }
}
for (const file of walkFiles(path.join(root, '.10x-squad', 'runtime'))) {
  discovered.add(path.relative(root, file));
}
for (const relative of [...discovered].sort((left, right) => left.localeCompare(right))) {
  if (!expectedTargets.has(path.normalize(relative))) {
    process.stdout.write(`${relative}\textra\n`);
  }
}

const skillsRoot = path.join(repo, 'assets', 'skills');
for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && !installer.skillNames.includes(entry.name)) {
    process.stdout.write(`assets/skills/${entry.name}\tunmanifested\n`);
  }
}
NODE
); then
  srcbad "unable to enumerate installer manifest"
  manifest_results=""
fi
while IFS=$'\t' read -r relative state; do
  [ -z "$relative" ] && continue
  case "$state" in
    current) ok "$relative: live == assets" ;;
    missing) srcbad "$relative: missing" ;;
    drifted) srcbad "$relative: live != assets" ;;
    not_regular) srcbad "$relative: not a regular owned file" ;;
    extra) srcbad "$relative: extra deployed file" ;;
    unmanifested) srcbad "$relative: absent from installer manifest" ;;
  esac
done <<< "$manifest_results"

if [ "$MODE" = "all" ]; then
  echo "== 3. Upstream distribution (corpay-agents) vs live lineage"
  for dir in "$LIVE_SKILLS"/10x-*/; do
    s="$(basename "$dir")"
    m_up="$(sum "$UPSTREAM/skills/$s/SKILL.md")"
    if [ "$m_up" = "$(sum "$dir/SKILL.md")" ]; then
      ok "$s: upstream current"
    elif [ "$m_up" = "MISSING" ]; then
      upbad "$s: absent upstream"
    else
      upbad "$s: upstream lags live"
    fi
  done
  if [ "$(sum "$UPSTREAM/agents/10x-squad.agent.md")" = "$(sum "$LIVE_AGENT")" ]; then
    ok "Vivaldi: upstream current"
  else
    upbad "Vivaldi: upstream lags live"
  fi

  echo "== 4. Claude Code port: do referenced skill paths resolve?"
  refs=$(grep -hoE '~?/?\.?[A-Za-z0-9_./~-]*skills/10x[a-z-]*' "$CLAUDE_CMDS"/10x*.md 2>/dev/null | sed 's|.*skills/|skills/|' | sort -u)
  if [ -z "$refs" ]; then
    echo "  (no 10x skill references found in $CLAUDE_CMDS)"
  else
    while IFS= read -r r; do
      name="${r#skills/}"
      if [ -f "$HOME/.claude/skills/$name/SKILL.md" ]; then
        ok "~/.claude/skills/$name resolves"
      else
        ptbad "~/.claude/skills/$name/SKILL.md missing (referenced by port commands)"
      fi
    done <<< "$refs"
  fi
fi

echo ""
echo "SOURCE failures:   $src_fail   (must always be 0 — the invariant this repo enforces)"
if [ "$MODE" = "--source-only" ]; then
  [ "$src_fail" -eq 0 ] && exit 0
  exit 1
fi

total=$((src_fail + up_fail + port_fail))
echo "UPSTREAM lag:      $up_fail   (resolve by PR to corpay-agents)"
echo "PORT dangling:     $port_fail   (resolve via installer Claude target — ladder step 4)"
echo "TOTAL: $total"
[ "$total" -eq 0 ] && exit 0
exit 1
