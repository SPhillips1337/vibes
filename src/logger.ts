import fs from 'fs';

const LOG_FILE = '/tmp/vibes-debug.log';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
type LogListener = (level: LogLevel, message: string, timestamp: string) => void;

const listeners: Set<LogListener> = new Set();

export function addLogListener(listener: LogListener) {
  listeners.add(listener);
}

export function removeLogListener(listener: LogListener) {
  listeners.delete(listener);
}

export function log(message: string, level: LogLevel = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
    listeners.forEach(l => l(level, message, timestamp));
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

export function logObject(label: string, obj: any) {
  log(`${label}: ${JSON.stringify(obj, null, 2)}`, 'DEBUG');
}

// Clear log on startup
export function initLogger() {
  try {
    fs.writeFileSync(LOG_FILE, `--- SESSION STARTED ${new Date().toISOString()} ---\n`);
  } catch (err) {
    console.error('Failed to initialize log file:', err);
  }
}
