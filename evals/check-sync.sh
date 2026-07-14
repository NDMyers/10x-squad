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
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
ROOT="${SQUAD_ROOT:-$(dirname "$REPO")}"
LIVE_SKILLS="$ROOT/.github/skills"
LIVE_AGENT="$ROOT/.github/agents/10x-squad.agent.md"
ASSETS="$REPO/assets"
INSTALLER="$REPO/lib/installer.js"
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
for dir in "$LIVE_SKILLS"/10x-*/; do
  s="$(basename "$dir")"
  if [ "$(sum "$dir/SKILL.md")" = "$(sum "$ASSETS/skills/$s/SKILL.md")" ]; then
    ok "$s: live == assets"
  else
    srcbad "$s: live != assets (edit flowed the wrong way, or assets stale)"
  fi
done
if [ "$(sum "$LIVE_AGENT")" = "$(sum "$ASSETS/agents/10x-squad.agent.md")" ]; then
  ok "Vivaldi: live == assets"
else
  srcbad "Vivaldi: live != assets (installer would ROLL BACK live edits)"
fi

echo "== 2. Installer manifest covers every live skill"
for dir in "$LIVE_SKILLS"/10x-*/; do
  s="$(basename "$dir")"
  if grep -q "'$s'" "$INSTALLER" 2>/dev/null; then
    ok "$s in installer skillNames"
  else
    srcbad "$s NOT in installer skillNames (fresh install would omit it)"
  fi
done

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

total=$((src_fail + up_fail + port_fail))
echo ""
echo "SOURCE failures:   $src_fail   (must always be 0 — the invariant this repo enforces)"
echo "UPSTREAM lag:      $up_fail   (resolve by PR to corpay-agents)"
echo "PORT dangling:     $port_fail   (resolve via installer Claude target — ladder step 4)"
echo "TOTAL: $total"
exit "$total"
