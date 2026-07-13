import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { LogEntry } from '../types';

class LoggingService {
  private logFilePath: string;
  private maxLogEntries = 1000;

  constructor() {
    // Determine the user data directory
    const userDataPath = app.getPath('userData');
    this.logFilePath = path.join(userDataPath, 'printflow_logs.json');
    this.ensureLogFileExists();
  }

  private ensureLogFileExists() {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2), 'utf8');
      }
    } catch (err) {
      console.error('Failed to create log file:', err);
    }
  }

  public log(level: 'info' | 'warn' | 'error', message: string, context?: string) {
    try {
      this.ensureLogFileExists();
      const rawData = fs.readFileSync(this.logFilePath, 'utf8');
      let logs: LogEntry[] = [];
      
      try {
        logs = JSON.parse(rawData);
      } catch {
        logs = [];
      }

      const newEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context,
      };

      // Push and rotate logs if exceeding threshold
      logs.unshift(newEntry); // Newest first
      if (logs.length > this.maxLogEntries) {
        logs = logs.slice(0, this.maxLogEntries);
      }

      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2), 'utf8');
      
      // Also write to standard terminal out
      const consoleMsg = `[${newEntry.timestamp}] [${level.toUpperCase()}] ${message} ${context ? `(${context})` : ''}`;
      if (level === 'error') {
        console.error(consoleMsg);
      } else if (level === 'warn') {
        console.warn(consoleMsg);
      } else {
        console.log(consoleMsg);
      }
    } catch (err) {
      console.error('Failed to write log entry:', err);
    }
  }

  public getLogs(): LogEntry[] {
    try {
      this.ensureLogFileExists();
      const rawData = fs.readFileSync(this.logFilePath, 'utf8');
      return JSON.parse(rawData);
    } catch {
      return [];
    }
  }

  public clearLogs(): boolean {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2), 'utf8');
      this.log('info', 'Logs cleared successfully');
      return true;
    } catch (err) {
      console.error('Failed to clear logs:', err);
      return false;
    }
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }
}

// Lazy loaded singleton
let instance: LoggingService | null = null;
export function getLoggingService(): LoggingService {
  if (!instance) {
    instance = new LoggingService();
  }
  return instance;
}
