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

process.on('uncaughtException', handleUncaughtException);
log('Catching uncaught exceptions...');

export {
  log,
  logError,
  logWarning,
  logErrorFilePath,
  logFilePath,
};
