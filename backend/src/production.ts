import { bootstrap } from './index.js';
import { prodConfig, validateProdConfig } from '../config/production.js';
import { logger } from './infrastructure/observability/logging/Logger.js';

async function startProduction() {
  try {
    // Validate configuration
    validateProdConfig();
    logger.info('Production configuration validated');

    // Bootstrap application
    const app = await bootstrap();
    
    // Start server
    const server = app.listen(prodConfig.app.port, prodConfig.app.host, () => {
      logger.info({
        event: 'server_started',
        port: prodConfig.app.port,
        host: prodConfig.app.host,
        environment: 'production',
        version: prodConfig.app.version,
      }, 'MENTORA Backend started');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      
      // Close server
      server.close(async () => {
        logger.info('Server closed');
        
        // Close database connections
        // Close Redis connections
        // Close queue connections
        
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Force shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error({
        event: 'uncaught_exception',
        error,
      }, 'Uncaught exception');
      
      // Graceful shutdown on critical errors
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({
        event: 'unhandled_rejection',
        reason,
      }, 'Unhandled rejection');
    });

  } catch (error) {
    logger.error({
      event: 'production_startup_failed',
      error,
    }, 'Failed to start production server');
    process.exit(1);
  }
}

startProduction();
