/**
 * Scoring Processor
 * Uses AI agents service to calculate Champion Index scores
 */

import { Job } from 'bull';
import axios from 'axios';
import { logger } from '@enekwe/icon-radar-shared';
import { ScoringJobData } from '../types';
import { scoringQueue } from '../services/queueManager';

export class ScoringProcessor {
  private aiAgentsUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.aiAgentsUrl = process.env.AI_AGENTS_URL || 'http://localhost:3009';
    this.serviceApiKey = process.env.SERVICE_API_KEY || '';
  }

  /**
   * Process Champion Index scoring job
   */
  async processScoring(job: Job<ScoringJobData>): Promise<{
    athleteId: string;
    rankingsUpdated: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const { athleteId, brandIds, recalculateAll } = job.data;

    logger.info(`Starting Champion Index scoring for athlete brands`, {
      jobId: job.id,
      athleteId,
      brandCount: brandIds.length,
      recalculateAll,
    });

    try {
      await job.progress(10);

      // Call AI agents service for scoring
      const response = await axios.post(
        `${this.aiAgentsUrl}/api/v1/agents/championindex/score`,
        {
          athleteId,
          brandIds,
          recalculateAll,
        },
        {
          headers: {
            'x-service-api-key': this.serviceApiKey,
            'x-correlation-id': `job-${job.id}`,
          },
          timeout: 180000, // 3 minutes
        }
      );

      await job.progress(90);

      const scoringResult = response.data.data;
      const rankingsUpdated = scoringResult.rankingsUpdated || 0;

      logger.info(`Champion Index scoring completed for athlete`, {
        jobId: job.id,
        athleteId,
        rankingsUpdated,
      });

      await job.progress(100);

      const processingTime = Date.now() - startTime;
      return {
        athleteId,
        rankingsUpdated,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(`Champion Index scoring failed for athlete`, {
        jobId: job.id,
        athleteId,
        error: error instanceof Error ? error.message : String(error),
        processingTime,
      });

      throw error;
    }
  }

  /**
   * Handle job retry logic
   */
  async handleJobRetry(job: Job<ScoringJobData>, error: Error): Promise<void> {
    const { athleteId, brandIds } = job.data;
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts.attempts || 2;

    logger.warn(`Scoring job retry ${attemptsMade}/${maxAttempts}`, {
      jobId: job.id,
      athleteId,
      brandCount: brandIds.length,
      error: error.message,
    });

    if (attemptsMade >= maxAttempts) {
      logger.error(`Scoring permanently failed after ${maxAttempts} attempts`, {
        jobId: job.id,
        athleteId,
        brandCount: brandIds.length,
        finalError: error.message,
      });
    }
  }
}

// Create processor instance
const processor = new ScoringProcessor();

// Get concurrency from env or default to 2
const concurrency = parseInt(process.env.JOB_CONCURRENCY_SCORING || '2');

// Register job processor
scoringQueue.process('calculate-index', concurrency, async (job: Job<ScoringJobData>) => {
  try {
    return await processor.processScoring(job);
  } catch (error) {
    await processor.handleJobRetry(job, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

logger.info(`Scoring processor registered with concurrency ${concurrency}`);

export default processor;
