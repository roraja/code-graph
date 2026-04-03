/**
 * Logger module for CodeGraph.
 * Uses winston for structured logging with configurable levels.
 *
 * @module config/logger
 */

import { createLogger, format, transports } from 'winston';

/** Shared logger instance for all CodeGraph modules */
export const logger = createLogger({
  level: process.env['CODEGRAPH_LOG_LEVEL'] ?? 'info',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    format.errors({ stack: true }),
    process.env['CODEGRAPH_LOG_JSON']
      ? format.json()
      : format.combine(
          format.colorize(),
          format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length
              ? ` ${JSON.stringify(meta)}`
              : '';
            return `${timestamp} ${level}: ${message}${metaStr}`;
          })
        )
  ),
  transports: [new transports.Console()],
  silent: process.env['CODEGRAPH_SILENT'] === 'true',
});

/**
 * Create a child logger with a specific module label.
 * Usage: `const log = createModuleLogger('parser');`
 */
export function createModuleLogger(moduleName: string) {
  return logger.child({ module: moduleName });
}
