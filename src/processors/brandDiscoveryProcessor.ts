/**
 * Brand Discovery Processor
 * Uses AI agents service to discover brands for athletes
 */

import { Job } from 'bull';
import axios from 'axios';
import { logger } from '@enekwe/icon-radar-shared';
import { BrandDiscoveryJobData } from '../types';
import { brandDiscoveryQueue } from '../services/queueManager';

export class BrandDiscoveryProcessor {
  private aiAgentsUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.aiAgentsUrl = process.env.AI_AGENTS_URL || 'http://localhost:3009';
    this.serviceApiKey = process.env.SERVICE_API_KEY || '';
  }

  /**
   * Process brand discovery job
   */
  async processBrandDiscovery(job: Job<BrandDiscoveryJobData>): Promise<{
    athleteId: string;
    brandsFound: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const { athleteId, athleteName, sport, batchId } = job.data;

    logger.info(`Starting brand discovery for athlete: ${athleteName}`, {
      jobId: job.id,
      athleteId,
      athleteName,
      sport,
      batchId,
    });

    try {
      await job.progress(10);

      // Call AI agents service for brand discovery
      const response = await axios.post(
        `${this.aiAgentsUrl}/api/v1/agents/brandlink/discover`,
        {
          athleteId,
          athleteName,
          sport,
          maxResults: 10,
        },
        {
          headers: {
            'x-service-api-key': this.serviceApiKey,
            'x-correlation-id': `job-${job.id}`,
          },
          timeout: 120000, // 2 minutes
        }
      );

      await job.progress(70);

      const discoveryResult = response.data.data;
      const brandsFound = discoveryResult.brandsDiscovered || 0;

      logger.info(`Brand discovery completed for ${athleteName}`, {
        jobId: job.id,
        athleteId,
        brandsFound,
      });

      await job.progress(100);

      const processingTime = Date.now() - startTime;
      return {
        athleteId,
        brandsFound,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(`Brand discovery failed for athlete: ${athleteName}`, {
        jobId: job.id,
        athleteId,
        error: error.message,
        processingTime,
      });

      throw error;
    }
  }

  /**
   * Handle job retry logic
   */
  async handleJobRetry(job: Job<BrandDiscoveryJobData>, error: Error): Promise<void> {
    const { athleteId, athleteName } = job.data;
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts.attempts || 3;

    logger.warn(`Brand discovery job retry ${attemptsMade}/${maxAttempts}`, {
      jobId: job.id,
      athleteId,
      athleteName,
      error: error.message,
    });

    if (attemptsMade >= maxAttempts) {
      logger.error(`Brand discovery permanently failed after ${maxAttempts} attempts`, {
        jobId: job.id,
        athleteId,
        athleteName,
        finalError: error.message,
      });
    }
  }
}

// Create processor instance
const processor = new BrandDiscoveryProcessor();

// Get concurrency from env or default to 5
const concurrency = parseInt(process.env.JOB_CONCURRENCY_BRAND_DISCOVERY || '5');

// Register job processor
brandDiscoveryQueue.process('discover-brands', concurrency, async (job: Job<BrandDiscoveryJobData>) => {
  try {
    return await processor.processBrandDiscovery(job);
  } catch (error) {
    await processor.handleJobRetry(job, error);
    throw error;
  }
});

logger.info(`Brand discovery processor registered with concurrency ${concurrency}`);

export default processor;
