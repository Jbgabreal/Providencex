// Date/Time utilities using Luxon
import { DateTime, IANAZone } from 'luxon';

const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Get current time in ProvidenceX timezone (America/New_York)
 */
export function getNowInPXTimezone(): DateTime {
  return DateTime.now().setZone(DEFAULT_TIMEZONE);
}

/**
 * Format date as YYYY-MM-DD in PX timezone
 */
export function formatDateForPX(date: DateTime = getNowInPXTimezone()): string {
  return date.toFormat('yyyy-MM-dd');
}

/**
 * Parse ISO string and convert to PX timezone
 */
export function parseToPXTimezone(isoString: string): DateTime {
  return DateTime.fromISO(isoString).setZone(DEFAULT_TIMEZONE);
}

/**
 * Check if a time is within a time window
 */
export function isTimeInWindow(
  time: DateTime,
  startTime: string,
  endTime: string
): boolean {
  const start = parseToPXTimezone(startTime);
  const end = parseToPXTimezone(endTime);
  return time >= start && time <= end;
}

/**
 * Logger utility
 */
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = getNowInPXTimezone().toISO();
    const argsStr = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    return `[${timestamp}] [${level}] [${this.context}] ${message}${argsStr}`;
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage('INFO', message, ...args));
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage('ERROR', message, ...args));
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('WARN', message, ...args));
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG === 'true') {
      console.debug(this.formatMessage('DEBUG', message, ...args));
    }
  }
}

/**
 * Custom error classes
 */
export class ProvidenceXError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'ProvidenceXError';
  }
}

export class ValidationError extends ProvidenceXError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ProvidenceXError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

