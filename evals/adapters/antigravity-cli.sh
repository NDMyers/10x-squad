#!/usr/bin/env bash
set -euo pipefail

workdir="${1:?workdir required}"
prompt_file="${2:?prompt file required}"
events_file="${3:?events file required}"
model="${4:?model required}"

# /10x-squad is a skill invoked by name in the Antigravity CLI session.
prompt=$(printf '/10x-squad %s' "$(cat "$prompt_file")")

args=(-p "$prompt" --model "$model" --mode auto --accept-edits)

# Clear inherited desktop/session signals so an eval run started from inside
# another Antigravity session resolves as antigravity-cli.
stdout_file="$(mktemp)"
cleanup() { rm -f "$stdout_file"; }
trap cleanup EXIT

set +e
(cd "$workdir" && env -u ANTIGRAVITY_APP_DATA_DIR -u ANTIGRAVITY_AGENTAPI_EXE -u __CFBundleIdentifier agy "${args[@]}" < /dev/null) > "$stdout_file"
agy_exit=$?
set -e

node -e '
const fs = require("node:fs");
const [eventsPath, model, exitCode, outPath] = process.argv.slice(1);
const output = fs.readFileSync(outPath, "utf8");
const event = {
  type: "assistant.turn_end",
  model,
  exit_code: Number(exitCode),
  output_length: output.length,
};
fs.writeFileSync(eventsPath, `${JSON.stringify(event)}\n`);
' "$events_file" "$model" "$agy_exit" "$stdout_file"

exit "$agy_exit"
