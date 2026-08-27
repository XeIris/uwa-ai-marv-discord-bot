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
  logError('----- UNHANDLED REJECTION: -----', reason);
}

process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);
log('Catching uncaught exceptions and unhandled rejections...');

export {
  log,
  logError,
  logWarning,
  logErrorFilePath,
  logFilePath,
};
