export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Context object for structured logging.
 */
export type LogContext = Record<string, unknown>;

/**
 * Structured log entry format.
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

/**
 * Numeric values for log level comparison.
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple structured JSON logger.
 * Outputs to stdout with JSON format for easy parsing by log aggregators.
 */
class Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LOG_LEVEL_VALUES[level];
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_VALUES[level] < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    // Use console methods for proper stderr/stdout routing
    const output = JSON.stringify(entry);
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }
}

export function createLogger(level: LogLevel = 'info'): Logger {
  return new Logger(level);
}

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (!_logger) {
    const logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    _logger = new Logger(logLevel);
  }
  return _logger;
}

export const logger = new Proxy({} as Logger, {
  get(_, prop: keyof Logger) {
    return getLogger()[prop].bind(getLogger());
  },
});
