#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

function sumUsage(events, keys) {
  const values = events
    .map((event) => event.usage || event.data?.usage || event.metrics?.usage)
    .filter((usage) => usage && typeof usage === 'object')
    .map((usage) => keys.map((key) => usage[key]).find((value) => Number.isFinite(value)))
    .filter(Number.isFinite);

  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function sumOptional(events, keys) {
  const values = events
    .flatMap((event) => [event, event.data, event.metrics].filter(Boolean))
    .map((container) => keys.map((key) => container[key]).find((value) => Number.isFinite(value)))
    .filter(Number.isFinite);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function isToolItem(item) {
  return Boolean(item && /(?:tool|command|execution)/.test(item.type || ''));
}

function isToolStart(event) {
  if (['tool.execution_start', 'tool.started'].includes(event.type)) {
    return true;
  }
  return event.type === 'item.started' && isToolItem(event.item);
}

function observedCount(events, predicate) {
  const count = events.filter(predicate).length;
  return count === 0 ? null : count;
}

function countModelCalls(events, harness) {
  const eventType = harness === 'codex-cli' ? 'turn.started' : 'assistant.turn_start';
  return observedCount(events, (event) => event.type === eventType);
}

function countToolCalls(events) {
  const started = events.filter(isToolStart);
  if (started.length > 0) {
    return new Set(started.map((event, index) => event.item?.id || event.id || `started-${index}`)).size;
  }
  const completed = events.filter((event) => event.type === 'item.completed' && isToolItem(event.item));
  return completed.length === 0
    ? null
    : new Set(completed.map((event, index) => event.item?.id || event.id || `completed-${index}`)).size;
}

function normalizeEvents(events, options) {
  const observedModels = [...new Set(
    events
      .flatMap((event) => [event.model, event.data?.model, event.item?.model])
      .filter((model) => typeof model === 'string' && model.length > 0)
  )].sort((left, right) => left.localeCompare(right));

  return {
    harness: options.harness,
    requested_model: options.model,
    observed_models: observedModels,
    agent_exit: options.exitCode,
    duration_ms: options.durationMs,
    input_tokens: sumUsage(events, ['input_tokens', 'prompt_tokens']),
    cached_input_tokens: sumUsage(events, ['cached_input_tokens', 'cache_read_input_tokens']),
    output_tokens: sumUsage(events, ['output_tokens', 'completion_tokens']),
    model_calls: countModelCalls(events, options.harness),
    subagent_calls: observedCount(events, (event) => event.type === 'subagent.started'),
    tool_calls: countToolCalls(events),
    cost_usd: sumOptional(events, ['cost_usd', 'total_cost_usd']),
    event_parse_errors: options.eventParseErrors || 0,
  };
}

function parseJsonLines(raw) {
  const events = [];
  let errors = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event === null || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || event.type.length === 0) {
        errors += 1;
        continue;
      }
      events.push(event);
    } catch {
      errors += 1;
    }
  }
  return { events, errors };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('options must be --name value pairs');
    }
    options[key.slice(2)] = value;
  }
  for (const required of ['events', 'harness', 'model', 'duration-ms', 'exit-code']) {
    if (options[required] === undefined) {
      throw new Error(`--${required} is required`);
    }
  }
  return options;
}

function main(argv) {
  try {
    const options = parseOptions(argv.slice(2));
    const parsed = parseJsonLines(fs.readFileSync(options.events, 'utf8'));
    const result = normalizeEvents(parsed.events, {
      harness: options.harness,
      model: options.model,
      durationMs: Number(options['duration-ms']),
      exitCode: Number(options['exit-code']),
      eventParseErrors: parsed.errors,
    });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(`normalize-events failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  normalizeEvents,
  parseJsonLines,
};