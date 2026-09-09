export const logger = {
  info: (message: string, context?: any) => {
    console.log(JSON.stringify({ level: 'info', message, ...context }));
  },
  error: (message: string, context?: any) => {
    console.error(JSON.stringify({ level: 'error', message, ...context }));
  },
  warn: (message: string, context?: any) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...context }));
  },
  debug: (message: string, context?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(JSON.stringify({ level: 'debug', message, ...context }));
    }
  },
};

export function getLogger() {
  return logger;
}
