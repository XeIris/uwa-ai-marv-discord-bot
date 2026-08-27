import fs from 'fs';
import path from 'path';

const logFilePath = path.join(import.meta.dir, '../persistence/logs.txt');
const logErrorFilePath = path.join(import.meta.dir, '../persistence/logs_error.txt');

function log(message: string): void {
  console.log(message);
  fs.appendFile(logFilePath, `${new Date().toISOString()} - ${message}\n`, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
}

function logError(message: string, error: unknown = ''): void {
  console.error(message, error);
  const errorStack = (error instanceof Error ? error.stack : String(error)) || String(error);
  fs.appendFile(logFilePath, `${new Date().toISOString()} - ERROR: ${message}\n${errorStack}\n`, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
  fs.appendFile(logErrorFilePath, `${new Date().toISOString()} - ERROR: ${message}\n${errorStack}\n`, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
}

function logWarning(message: string): void {
  console.warn(message);
  fs.appendFile(logFilePath, `${new Date().toISOString()} - WARNING: ${message}\n`, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
}

function handleUncaughtException(error: Error): void {
  logError('----- UNCAUGHT EXCEPTION: -----', error);
}

/** Credential shapes worth scrubbing before a rejection reason hits disk. */
const SECRET_PATTERNS: RegExp[] = [
  // Authorization headers, and the API key shapes this bot actually holds
  // (OpenRouter `sk-or-...`, OpenAI-style `sk-...`, Discord bot tokens).
  /\b(bearer\s+)[\w.\-~+/]+=*/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
];

/** Anything longer than this is a payload, not a diagnostic. */
const MAX_REJECTION_CHARS = 4000;

/**
 * Rejection reasons are arbitrary values from anywhere in the process, and this
 * handler writes them to disk. A rejected provider call can carry an
 * Authorization header or a multi-MB base64 image in its message, so scrub the
 * credential shapes and cap the length before persisting. Best-effort: this
 * reduces the blast radius of an unlucky reason, it is not a guarantee, so the
 * rule against deliberately logging secrets still stands.
 */
function sanitizeRejectionReason(reason: unknown): string {
  const raw = reason instanceof Error
    ? (reason.stack || `${reason.name}: ${reason.message}`)
    : String(reason);
  const scrubbed = SECRET_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, (m, prefix = '') => `${prefix}[redacted]`),
    raw,
  );
  return scrubbed.length > MAX_REJECTION_CHARS
    ? `${scrubbed.slice(0, MAX_REJECTION_CHARS)}… [truncated, ${scrubbed.length} chars total]`
    : scrubbed;
}

/**
 * Bun 1.4 makes an unawaited rejected promise fatal by default: with no
 * listener the process exits 1. Plenty of this bot's work is deliberately not
 * awaited — the event scheduler's ticks, the keyword handler, the interaction
 * dispatcher — so a single rejection in any of them would take the whole bot
 * down and leave Docker to restart it.
 *
 * Swallowing can mask a genuinely broken state, so the reason is always written
 * to logs_error.txt. This is the same trade the codebase already makes for sync
 * throws in handleUncaughtException above; it's a backstop, not a substitute for
 * catching failures where they happen and giving them a name in the log.
 */
function handleUnhandledRejection(reason: unknown): void {
  logError('----- UNHANDLED REJECTION: -----', sanitizeRejectionReason(reason));
}

process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);
log('Catching uncaught exceptions and unhandled rejections...');

export {
  log,
  sanitizeRejectionReason,
  logError,
  logWarning,
  logErrorFilePath,
  logFilePath,
};
