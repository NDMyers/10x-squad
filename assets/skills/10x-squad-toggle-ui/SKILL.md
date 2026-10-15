---
name: 10x-squad-toggle-ui
description: Use when the user invokes /10x-squad-toggle-ui or asks to enable, disable, toggle, check status of, or open the live 10x Squad Workflow Monitor UI.
---

# Toggle 10x Squad Workflow Monitor UI

Controls whether Vivaldi automatically generates, updates, and opens the live HTML Workflow Monitor (`dashboard.html`) when a 10x Squad pipeline runs.

The setting is persisted in `~/.config/10x-squad/ui.json` (global default) or `<workspace>/.10x-squad/ui.json` (workspace override). By default, the UI is **enabled** (`enabled: true, auto_open: true`).

## Workflow

1. Determine the user's intent:
   - If the user passed an explicit state (`on`, `enable`, `off`, `disable`, `status`), use `--on`, `--off`, or `--status`.
   - If the user simply invoked `/10x-squad-toggle-ui` with no arguments, use `--toggle` to flip the current setting (`on <-> off`).
   - Use `--scope workspace` only if the user explicitly asks for workspace-only configuration; otherwise default to `--scope global`.

2. Run the deterministic runtime command:

   ```bash
   node .10x-squad/runtime/control.js toggle-ui \
     [--toggle | --on | --off | --status] \
     [--scope global|workspace] \
     --workspace-root "$PWD" \
     [--project 10x-squad-artifacts/projects/<active-slug>]
   ```

3. Consume the single-line JSON output (`{"ok":true,"enabled":true|false,"auto_open":true|false,"scope":"global"|"workspace","path":"...","dashboard_path":"..."}`):
   - If `enabled` is `true` and an active project exists (so `dashboard_path` is returned), immediately open `file://<dashboard_path>` in the integrated browser (`openBrowserPage`) if available on the current surface.
   - Report the new state (`Enabled` or `Disabled`), the config scope (`global` or `workspace`), and that Vivaldi will automatically open/skip the Workflow Monitor on squad runs.
