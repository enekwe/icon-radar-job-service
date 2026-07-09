/**
 * Verification Processor
 * Uses AI agents service to verify brand ownership
 */

import { Job } from 'bull';
import axios from 'axios';
import logger from '../utils/logger';
import { VerificationJobData } from '../types';
import { verificationQueue } from '../services/queueManager';

export class VerificationProcessor {
  private aiAgentsUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.aiAgentsUrl = process.env.AI_AGENTS_URL || 'http://localhost:3009';
    this.serviceApiKey = process.env.SERVICE_API_KEY || '';
  }

  /**
   * Process ownership verification job
   */
  async processVerification(job: Job<VerificationJobData>): Promise<{
    athleteId: string;
    totalVerified: number;
    totalUnverified: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const { athleteId, brandIds, batchId } = job.data;

    logger.info(`Starting verification for athlete brands`, {
      jobId: job.id,
      athleteId,
      brandCount: brandIds.length,
      batchId,
    });

    try {
      await job.progress(10);

      // Call AI agents service for verification
      const response = await axios.post(
        `${this.aiAgentsUrl}/api/v1/agents/bizdataclean/verify`,
        {
          athleteId,
          brandIds,
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

      const verificationResult = response.data.data;
      const totalVerified = verificationResult.verified || 0;
      const totalUnverified = verificationResult.unverified || 0;

      logger.info(`Verification completed for athlete`, {
        jobId: job.id,
        athleteId,
        totalVerified,
        totalUnverified,
      });

      await job.progress(100);

      const processingTime = Date.now() - startTime;
      return {
        athleteId,
        totalVerified,
        totalUnverified,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(`Verification failed for athlete`, {
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
  async handleJobRetry(job: Job<VerificationJobData>, error: Error): Promise<void> {
    const { athleteId, brandIds } = job.data;
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts.attempts || 2;

    logger.warn(`Verification job retry ${attemptsMade}/${maxAttempts}`, {
      jobId: job.id,
      athleteId,
      brandCount: brandIds.length,
      error: error.message,
    });

    if (attemptsMade >= maxAttempts) {
      logger.error(`Verification permanently failed after ${maxAttempts} attempts`, {
        jobId: job.id,
        athleteId,
        brandCount: brandIds.length,
        finalError: error.message,
      });
    }
  }
}

// Create processor instance
const processor = new VerificationProcessor();

// Get concurrency from env or default to 3
const concurrency = parseInt(process.env.JOB_CONCURRENCY_VERIFICATION || '3');

// Register job processor
verificationQueue.process('verify-ownership', concurrency, async (job: Job<VerificationJobData>) => {
  try {
    return await processor.processVerification(job);
  } catch (error) {
    await processor.handleJobRetry(job, error);
    throw error;
  }
});

logger.info(`Verification processor registered with concurrency ${concurrency}`);

export default processor;
