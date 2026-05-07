import fs from 'fs';

const LOG_FILE = '/tmp/vibes-debug.log';

export function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
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
