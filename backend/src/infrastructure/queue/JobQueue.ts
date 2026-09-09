import { logger } from '../logging/logger.js';

export interface Job {
  id: string;
  type: string;
  payload: any;
  priority: 'high' | 'medium' | 'low';
  retryCount: number;
  maxRetries: number;
  scheduledAt: Date;
  createdAt: Date;
}

export class JobQueue {
  private jobs: Job[] = [];
  private processing: boolean = false;
  private static instance: JobQueue;

  static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  async enqueue(
    type: string,
    payload: any,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<string> {
    const job: Job = {
      id: crypto.randomUUID(),
      type,
      payload,
      priority,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(),
      createdAt: new Date(),
    };

    this.jobs.push(job);
    this.sortJobs();
    this.process();

    logger.debug({
      jobId: job.id,
      type: job.type,
      priority: job.priority,
    }, 'Job enqueued');

    return job.id;
  }

  private sortJobs(): void {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    this.jobs.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.jobs.length === 0) return;

    this.processing = true;

    try {
      const job = this.jobs.shift()!;
      await this.executeJob(job);
    } finally {
      this.processing = false;
      if (this.jobs.length > 0) {
        setImmediate(() => this.process());
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    try {
      const handlers: Record<string, (payload: any) => Promise<void>> = {
        'mastery.update': this.handleMasteryUpdate.bind(this),
        'analytics.aggregate': this.handleAnalyticsAggregate.bind(this),
        'ai.recommendation': this.handleAIRecommendation.bind(this),
        'email.send': this.handleEmailSend.bind(this),
        'notification.send': this.handleNotificationSend.bind(this),
      };

      const handler = handlers[job.type];
      if (!handler) {
        logger.warn({ jobType: job.type }, 'No handler for job type');
        return;
      }

      await handler(job.payload);
      
      logger.debug({
        jobId: job.id,
        type: job.type,
      }, 'Job executed successfully');
    } catch (error) {
      logger.error({
        jobId: job.id,
        type: job.type,
        error,
        retryCount: job.retryCount,
      }, 'Job execution failed');

      if (job.retryCount < job.maxRetries) {
        // Retry with backoff
        job.retryCount++;
        const backoffMs = Math.pow(2, job.retryCount) * 1000;
        job.scheduledAt = new Date(Date.now() + backoffMs);
        this.jobs.push(job);
        this.sortJobs();
        logger.info({
          jobId: job.id,
          retryCount: job.retryCount,
          delayMs: backoffMs,
        }, 'Job scheduled for retry');
      } else {
        logger.error({
          jobId: job.id,
          type: job.type,
          maxRetries: job.maxRetries,
        }, 'Job permanently failed');
      }
    }
  }

  private async handleMasteryUpdate(payload: any): Promise<void> {
    // Process mastery updates asynchronously
    logger.debug({ payload }, 'Processing mastery update');
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing
  }

  private async handleAnalyticsAggregate(payload: any): Promise<void> {
    // Aggregate analytics data
    logger.debug({ payload }, 'Processing analytics aggregation');
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  private async handleAIRecommendation(payload: any): Promise<void> {
    // Generate AI recommendations
    logger.debug({ payload }, 'Processing AI recommendation');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  private async handleEmailSend(payload: any): Promise<void> {
    // Send emails
    logger.debug({ payload }, 'Processing email send');
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleNotificationSend(payload: any): Promise<void> {
    // Send notifications
    logger.debug({ payload }, 'Processing notification send');
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  getStats(): { total: number; byPriority: Record<string, number> } {
    const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const job of this.jobs) {
      byPriority[job.priority] = (byPriority[job.priority] || 0) + 1;
    }

    return {
      total: this.jobs.length,
      byPriority,
    };
  }
}
