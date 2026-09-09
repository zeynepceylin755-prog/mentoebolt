import { logger } from '../logging/logger.js';

export interface PerformanceMetric {
  operation: string;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetric[] = [];

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    let success = true;
    
    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - start;
      this.recordMetric({
        operation,
        durationMs: duration,
        success,
        metadata,
      });

      if (duration > 1000) {
        logger.warn({
          operation,
          durationMs: duration,
          success,
        }, `Slow operation detected: ${operation} took ${duration}ms`);
      }
    }
  }

  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > 10000) {
      this.metrics.shift();
    }

    // Log slow operations
    if (metric.durationMs > 500) {
      logger.debug({
        operation: metric.operation,
        durationMs: metric.durationMs,
        success: metric.success,
        metadata: metric.metadata,
      }, 'Slow operation');
    }
  }

  getMetrics(): PerformanceMetric[] {
    return this.metrics;
  }

  getAverageDuration(operation: string): number {
    const ops = this.metrics.filter(m => m.operation === operation);
    if (ops.length === 0) return 0;
    const total = ops.reduce((sum, m) => sum + m.durationMs, 0);
    return total / ops.length;
  }

  getSlowestOperations(limit: number = 10): PerformanceMetric[] {
    return [...this.metrics]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit);
  }

  reset(): void {
    this.metrics = [];
    logger.info('Performance metrics reset');
  }
}
