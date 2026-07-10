/**
 * Pipeline Processor
 * Orchestrates complete AI agent pipeline for athlete processing
 */

import { Job } from 'bull';
import { logger } from '@enekwe/icon-radar-shared';
import { PipelineJobData } from '../types';
import {
  pipelineQueue,
  PipelineOrchestrator,
  queueEventEmitter,
  addBrandDiscoveryJob,
  addVerificationJob,
  addMetricsJob,
  addScoringJob,
} from '../services/queueManager';
import axios from 'axios';

export class PipelineProcessor {
  private readonly PIPELINE_STEPS = [
    'brand_discovery',
    'verification',
    'metrics_collection',
    'scoring',
  ];

  private athleteServiceUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.athleteServiceUrl = process.env.ATHLETE_SERVICE_URL || 'http://localhost:3002';
    this.serviceApiKey = process.env.SERVICE_API_KEY || '';
  }

  /**
   * Process complete pipeline for multiple athletes
   */
  async processPipeline(job: Job<PipelineJobData>): Promise<{
    pipelineId: string;
    athletesProcessed: number;
    successfulAthletes: number;
    failedAthletes: number;
    totalProcessingTime: number;
  }> {
    const startTime = Date.now();
    const { pipelineId, athleteIds, userId, options } = job.data;

    logger.info(`Starting pipeline processing for ${athleteIds.length} athletes`, {
      jobId: job.id,
      pipelineId,
      athleteCount: athleteIds.length,
      userId,
      options,
    });

    try {
      // Get orchestrator instance
      const orchestrator = PipelineOrchestrator.getInstance();

      await job.progress(5);

      // Get athlete details from athlete service
      const response = await axios.post(
        `${this.athleteServiceUrl}/api/v1/athletes/batch`,
        { athleteIds },
        {
          headers: {
            'x-service-api-key': this.serviceApiKey,
            'x-correlation-id': `pipeline-${pipelineId}`,
          },
        }
      );

      const athletes: Array<{ id: string; name: string; sport?: string; brandIds?: string[] }> = response.data.data || [];

      if (athletes.length !== athleteIds.length) {
        const foundIds = athletes.map((a) => a.id);
        const missingIds = athleteIds.filter(id => !foundIds.includes(id));
        logger.warn(`Some athletes not found`, { missingIds, pipelineId });
      }

      await job.progress(10);

      const concurrency = options?.concurrency || 5;
      const athleteResults: any[] = [];
      let processedCount = 0;

      // Process athletes in batches for concurrency control
      const batches = this.createBatches(athletes, concurrency);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchId = `${pipelineId}_batch_${batchIndex}`;

        logger.info(`Processing batch ${batchIndex + 1}/${batches.length}`, {
          pipelineId,
          batchId,
          athleteCount: batch.length,
        });

        // Process batch concurrently
        const batchPromises = batch.map(athlete =>
          this.processAthleteWorkflow(athlete, batchId, options || {})
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Collect results
        batchResults.forEach((result, index) => {
          const athlete = batch[index];
          processedCount++;

          if (result.status === 'fulfilled') {
            athleteResults.push({
              athleteId: athlete?.id || 'unknown',
              athleteName: athlete?.name || 'unknown',
              status: result.value.status,
              stepsCompleted: result.value.stepsCompleted,
              totalSteps: result.value.totalSteps,
              processingTime: result.value.processingTime,
            });
          } else {
            athleteResults.push({
              athleteId: athlete?.id || 'unknown',
              athleteName: athlete?.name || 'unknown',
              status: 'failed',
              stepsCompleted: 0,
              totalSteps: this.PIPELINE_STEPS.length,
              processingTime: 0,
              error: result.reason.message,
            });
          }

          // Update overall progress
          const overallProgress = Math.floor(10 + (processedCount / athletes.length) * 85);
          job.progress(overallProgress);
        });

        // Emit batch completion event
        queueEventEmitter.emit('pipeline:batch_completed', {
          pipelineId,
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          athletesProcessed: processedCount,
          totalAthletes: athletes.length,
        });
      }

      await job.progress(95);

      // Update pipeline status
      const pipeline = orchestrator.getPipelineStatus(pipelineId);
      if (pipeline) {
        pipeline.status = 'completed';
        pipeline.progress = 100;
      }

      await job.progress(100);

      const totalProcessingTime = Date.now() - startTime;
      const successfulAthletes = athleteResults.filter(r => r.status === 'completed').length;
      const failedAthletes = athleteResults.filter(r => r.status === 'failed').length;

      const result = {
        pipelineId,
        athletesProcessed: athletes.length,
        successfulAthletes,
        failedAthletes,
        totalProcessingTime,
      };

      logger.info(`Pipeline processing completed`, {
        ...result,
        jobId: job.id,
      });

      // Emit pipeline completion event
      queueEventEmitter.emit('pipeline:completed', {
        pipelineId,
        result,
      });

      return result;
    } catch (error) {
      const totalProcessingTime = Date.now() - startTime;

      logger.error(`Pipeline processing failed`, {
        jobId: job.id,
        pipelineId,
        error: error instanceof Error ? error.message : String(error),
        totalProcessingTime,
      });

      // Update pipeline status
      const orchestrator = PipelineOrchestrator.getInstance();
      const pipeline = orchestrator.getPipelineStatus(pipelineId);
      if (pipeline) {
        pipeline.status = 'failed';
      }

      // Emit pipeline failure event
      queueEventEmitter.emit('pipeline:failed', {
        pipelineId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Process complete workflow for a single athlete
   */
  private async processAthleteWorkflow(
    athlete: any,
    batchId: string,
    options: {
      skipVerification?: boolean;
      skipMetrics?: boolean;
      skipScoring?: boolean;
    }
  ): Promise<{
    athleteId: string;
    status: 'completed' | 'failed' | 'partial';
    stepsCompleted: number;
    totalSteps: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const { id: athleteId, name: athleteName } = athlete;

    logger.info(`Starting athlete workflow`, { athleteId, athleteName, batchId });

    let stepsCompleted = 0;
    const totalSteps = this.PIPELINE_STEPS.filter(step => {
      if (step === 'verification' && options.skipVerification) return false;
      if (step === 'metrics_collection' && options.skipMetrics) return false;
      if (step === 'scoring' && options.skipScoring) return false;
      return true;
    }).length;

    try {
      // Step 1: Brand Discovery
      logger.info(`Step 1: Brand Discovery`, { athleteId, athleteName });

      const discoveryJob = await addBrandDiscoveryJob({
        athleteId,
        athleteName,
        sport: athlete.sport,
        batchId,
      });

      await this.waitForJobCompletion(discoveryJob);
      stepsCompleted++;

      logger.info(`Brand discovery completed`, { athleteId });

      // Get brand IDs for subsequent steps
      const brandIds = athlete.brandIds || [];

      // Step 2: Verification (if not skipped and brands found)
      if (!options.skipVerification && brandIds.length > 0) {
        logger.info(`Step 2: Verification`, { athleteId, athleteName, brandCount: brandIds.length });

        const verificationJob = await addVerificationJob({
          athleteId,
          brandIds,
          batchId,
        });

        await this.waitForJobCompletion(verificationJob);
        stepsCompleted++;

        logger.info(`Verification completed`, { athleteId });
      } else if (options.skipVerification) {
        logger.info(`Step 2: Verification skipped`, { athleteId });
      }

      // Step 3: Metrics Collection (if not skipped and brands found)
      if (!options.skipMetrics && brandIds.length > 0) {
        logger.info(`Step 3: Metrics Collection`, { athleteId, athleteName });

        // Note: In real implementation, would collect metrics for each brand
        // For now, we'll create a single job
        const metricsJobs = [];
        for (const brandId of brandIds.slice(0, 5)) {
          const metricsJob = await addMetricsJob({
            brandId,
            brandName: `Brand-${brandId}`,
            socialProfiles: {},
            batchId,
          });
          metricsJobs.push(metricsJob);
        }

        await Promise.all(metricsJobs.map(job => this.waitForJobCompletion(job)));
        stepsCompleted++;

        logger.info(`Metrics collection completed`, { athleteId });
      } else if (options.skipMetrics) {
        logger.info(`Step 3: Metrics Collection skipped`, { athleteId });
      }

      // Step 4: Champion Index Scoring (if not skipped and brands found)
      if (!options.skipScoring && brandIds.length > 0) {
        logger.info(`Step 4: Champion Index Scoring`, { athleteId, athleteName });

        const scoringJob = await addScoringJob({
          athleteId,
          brandIds,
          batchId,
        });

        await this.waitForJobCompletion(scoringJob);
        stepsCompleted++;

        logger.info(`Champion Index scoring completed`, { athleteId });
      } else if (options.skipScoring) {
        logger.info(`Step 4: Champion Index Scoring skipped`, { athleteId });
      }

      const processingTime = Date.now() - startTime;
      const status = stepsCompleted === totalSteps ? 'completed' : 'partial';

      logger.info(`Athlete workflow completed`, {
        athleteId,
        athleteName,
        status,
        stepsCompleted,
        totalSteps,
        processingTime,
      });

      return {
        athleteId,
        status,
        stepsCompleted,
        totalSteps,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(`Athlete workflow failed`, {
        athleteId,
        athleteName,
        error: error instanceof Error ? error.message : String(error),
        stepsCompleted,
        totalSteps,
        processingTime,
      });

      return {
        athleteId,
        status: 'failed',
        stepsCompleted,
        totalSteps,
        processingTime,
      };
    }
  }

  /**
   * Wait for job completion with timeout
   */
  private async waitForJobCompletion(job: Job, timeoutMs: number = 300000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Job ${job.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      job.finished()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Create batches for concurrent processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

// Create processor instance
const processor = new PipelineProcessor();

// Get concurrency from env or default to 1
const concurrency = parseInt(process.env.JOB_CONCURRENCY_PIPELINE || '1');

// Register job processor (single concurrency for pipeline orchestration)
pipelineQueue.process('process-pipeline', concurrency, async (job: Job<PipelineJobData>) => {
  try {
    return await processor.processPipeline(job);
  } catch (error) {
    throw error;
  }
});

logger.info(`Pipeline processor registered with concurrency ${concurrency}`);

export default processor;
