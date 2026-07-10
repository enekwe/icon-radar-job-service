/**
 * Job Processor Service
 * Monitors and tracks job execution
 */

import { logger } from '@enekwe/icon-radar-shared';
import { allQueues } from './queueManager';

export class JobMonitor {
  /**
   * Get job status by ID
   */
  async getJobStatus(jobId: string): Promise<any | null> {
    for (const queue of allQueues) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          const progress = (job as any)._progress || 0;

          return {
            jobId: job.id,
            queueName: queue.name,
            state,
            progress,
            data: job.data,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
            returnvalue: job.returnvalue,
          };
        }
      } catch (error) {
        logger.error(`Error getting job status from queue ${queue.name}`, { jobId, error });
      }
    }

    return null;
  }

  /**
   * Get failed jobs from a specific queue
   */
  async getFailedJobs(queueName: string, limit: number = 20): Promise<any[]> {
    const queue = allQueues.find((q) => q.name === queueName);
    if (!queue) {
      logger.warn(`Queue not found: ${queueName}`);
      return [];
    }

    try {
      const failedJobs = await queue.getFailed(0, limit - 1);

      return failedJobs.map((job) => ({
        jobId: job.id,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      }));
    } catch (error) {
      logger.error(`Error getting failed jobs from queue ${queueName}`, { error });
      return [];
    }
  }

  /**
   * Collect metrics across all queues
   */
  async collectMetrics(): Promise<{
    queues: Record<string, any>;
    system: {
      totalJobs: number;
      activeJobs: number;
      failedJobs: number;
      completedJobs: number;
    };
  }> {
    const queueMetrics: Record<string, any> = {};
    let totalJobs = 0;
    let activeJobs = 0;
    let failedJobs = 0;
    let completedJobs = 0;

    for (const queue of allQueues) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      queueMetrics[queue.name] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      };

      totalJobs += waiting + active + completed + failed + delayed;
      activeJobs += active;
      failedJobs += failed;
      completedJobs += completed;
    }

    return {
      queues: queueMetrics,
      system: {
        totalJobs,
        activeJobs,
        failedJobs,
        completedJobs,
      },
    };
  }
}

// Export singleton instance
export default new JobMonitor();
