/**
 * Logger
 */
import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.log.level,
  transport:
    config.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export type Logger = typeof logger;
