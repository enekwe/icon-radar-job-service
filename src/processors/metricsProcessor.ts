/**
 * Metrics Processor
 * Uses AI agents service to collect brand metrics
 */

import { Job } from 'bull';
import axios from 'axios';
import { logger } from '@enekwe/icon-radar-shared';
import { MetricsJobData } from '../types';
import { metricsQueue } from '../services/queueManager';

export class MetricsProcessor {
  private aiAgentsUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.aiAgentsUrl = process.env.AI_AGENTS_URL || 'http://localhost:3009';
    this.serviceApiKey = process.env.SERVICE_API_KEY || '';
  }

  /**
   * Process metrics collection job
   */
  async processMetrics(job: Job<MetricsJobData>): Promise<{
    brandId: string;
    brandName: string;
    metricsCollected: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const { brandId, brandName, socialProfiles, batchId } = job.data;

    logger.info(`Starting metrics collection for brand: ${brandName}`, {
      jobId: job.id,
      brandId,
      brandName,
      platforms: Object.keys(socialProfiles),
      batchId,
    });

    try {
      await job.progress(10);

      // Call AI agents service for metrics collection
      const response = await axios.post(
        `${this.aiAgentsUrl}/api/v1/agents/brandtrend/metrics`,
        {
          brandId,
          brandName,
          socialProfiles,
        },
        {
          headers: {
            'x-service-api-key': this.serviceApiKey,
            'x-correlation-id': `job-${job.id}`,
          },
          timeout: 180000, // 3 minutes
        }
      );

      await job.progress(85);

      const metricsResult = response.data.data;
      const metricsCollected = metricsResult.metricsCollected || 0;

      logger.info(`Metrics collection completed for brand: ${brandName}`, {
        jobId: job.id,
        brandId,
        metricsCollected,
      });

      await job.progress(100);

      const processingTime = Date.now() - startTime;
      return {
        brandId,
        brandName,
        metricsCollected,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(`Metrics collection failed for brand: ${brandName}`, {
        jobId: job.id,
        brandId,
        error: error instanceof Error ? error.message : String(error),
        processingTime,
      });

      throw error;
    }
  }

  /**
   * Handle job retry logic
   */
  async handleJobRetry(job: Job<MetricsJobData>, error: Error): Promise<void> {
    const { brandId, brandName } = job.data;
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts.attempts || 3;

    logger.warn(`Metrics collection job retry ${attemptsMade}/${maxAttempts}`, {
      jobId: job.id,
      brandId,
      brandName,
      error: error.message,
    });

    if (attemptsMade >= maxAttempts) {
      logger.error(`Metrics collection permanently failed after ${maxAttempts} attempts`, {
        jobId: job.id,
        brandId,
        brandName,
        finalError: error.message,
      });
    }
  }
}

// Create processor instance
const processor = new MetricsProcessor();

// Get concurrency from env or default to 4
const concurrency = parseInt(process.env.JOB_CONCURRENCY_METRICS || '4');

// Register job processor
metricsQueue.process('collect-metrics', concurrency, async (job: Job<MetricsJobData>) => {
  try {
    return await processor.processMetrics(job);
  } catch (error) {
    await processor.handleJobRetry(job, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

logger.info(`Metrics processor registered with concurrency ${concurrency}`);

export default processor;
