export class MetricsCollector {
  private static instance: MetricsCollector;
  private counters: Map<string, number> = new Map();

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  incrementCounter(name: string, increment: number = 1, labels?: Record<string, string>): void {
    const key = labels ? `${name}{${Object.entries(labels).map(([k,v]) => `${k}=${v}`).join(',')}}` : name;
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + increment);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    // Simple logging for now
    if (process.env.NODE_ENV === 'development') {
      console.debug(`Histogram: ${name} = ${value}`, labels);
    }
  }

  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  getMetricsSummary(): any {
    return {
      timestamp: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
    };
  }

  reset(): void {
    this.counters.clear();
  }
}

export const metrics = MetricsCollector.getInstance();
