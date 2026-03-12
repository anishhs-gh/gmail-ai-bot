'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const traceStorage = new AsyncLocalStorage();

const LEVELS = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.INFO;

function structuredLog(severity, message, fields = {}) {
  if (LEVELS[severity] < MIN_LEVEL) return;

  const traceId = traceStorage.getStore()?.traceId;
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...(traceId && { 'logging.googleapis.com/trace': traceId }),
    ...sanitize(fields),
  };

  if (process.env.NODE_ENV !== 'production') {
    const colors = { DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARNING: '\x1b[33m', ERROR: '\x1b[31m', CRITICAL: '\x1b[35m' };
    const reset = '\x1b[0m';
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(sanitize(fields))}` : '';
    console.log(`${colors[severity]}[${severity}]${reset} ${message}${extra}`);
  } else {
    console.log(JSON.stringify(entry));
  }
}

const SENSITIVE_KEYS = new Set(['password', 'token', 'key', 'secret', 'authorization', 'credential']);

function sanitize(obj, depth = 0) {
  if (depth > 3 || typeof obj !== 'object' || obj === null) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (k === 'body' && typeof v === 'string' && v.length > 300) {
      out[k] = v.slice(0, 300) + '…[truncated]';
    } else if (typeof v === 'object') {
      out[k] = sanitize(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const logger = {
  debug: (msg, fields) => structuredLog('DEBUG', msg, fields),
  info: (msg, fields) => structuredLog('INFO', msg, fields),
  warn: (msg, fields) => structuredLog('WARNING', msg, fields),
  error: (msg, errOrFields, fields) => {
    const extra = errOrFields instanceof Error
      ? { error: errOrFields.message, stack: errOrFields.stack, ...fields }
      : { ...errOrFields, ...fields };
    structuredLog('ERROR', msg, extra);
  },
  critical: (msg, fields) => structuredLog('CRITICAL', msg, fields),
  runWithTrace: (traceId, fn) => traceStorage.run({ traceId }, fn),
};

module.exports = logger;
