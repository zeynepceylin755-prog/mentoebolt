import pino from 'pino';
import { getEnv } from '../config/environment.js';

const env = getEnv();

const logger = pino({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});

export { logger };
