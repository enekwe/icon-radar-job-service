/**
 * Job Controller
 * Handles REST API endpoints for job management
 */

import { Request, Response } from 'express';
import { body, param } from 'express-validator';
import { logger } from '@enekwe/icon-radar-shared';
import {
  BatchProcessor,
  addBrandDiscoveryJob,
  addVerificationJob,
  addMetricsJob,
  addScoringJob,
  getQueueStatuses,
  PipelineOrchestrator,
} from '../services/queueManager';
import jobMonitor from '../services/jobProcessor';
import { getSchedulerStatus, triggerScheduledJob } from '../services/schedulerService';

/**
 * Start batch processing for multiple athletes
 */
export const startBatchProcessing = [
  body('athleteIds')
    .isArray({ min: 1, max: 500 })
    .withMessage('athleteIds must be an array with 1-500 items'),
  body('athleteIds.*').isUUID().withMessage('Each athleteId must be a valid UUID'),
  body('options.concurrency')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Concurrency must be between 1 and 20'),
  body('options.skipVerification').optional().isBoolean(),
  body('options.skipMetrics').optional().isBoolean(),
  body('options.skipScoring').optional().isBoolean(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { athleteIds, options = {} } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Starting batch processing request', {
        athleteCount: athleteIds.length,
        userId,
        options,
        correlationId: req.correlationId,
      });

      const pipelineId = await BatchProcessor.processAthletesBatch(athleteIds, userId, options);

      logger.info('Batch processing started', {
        pipelineId,
        athleteCount: athleteIds.length,
        userId,
      });

      res.json({
        success: true,
        data: {
          pipelineId,
          athleteCount: athleteIds.length,
          status: 'started',
        },
      });
    } catch (error) {
      logger.error('Failed to start batch processing:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start batch processing',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Get batch processing status
 */
export const getBatchStatus = [
  param('pipelineId').isString().notEmpty(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { pipelineId } = req.params;

      const orchestrator = PipelineOrchestrator.getInstance();
      const pipeline = orchestrator.getPipelineStatus(pipelineId);

      if (!pipeline) {
        res.status(404).json({
          success: false,
          error: 'Pipeline not found',
        });
        return;
      }

      res.json({
        success: true,
        data: {
          pipelineId,
          status: pipeline.status,
          progress: pipeline.progress,
          athleteCount: pipeline.athleteIds.length,
          createdAt: pipeline.createdAt,
          userId: pipeline.userId,
        },
      });
    } catch (error) {
      logger.error('Failed to get batch status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get batch status',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Pause batch processing
 */
export const pauseBatch = [
  param('pipelineId').isString().notEmpty(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { pipelineId } = req.params;

      await BatchProcessor.pauseBatch(pipelineId);

      logger.info('Batch processing paused', { pipelineId });

      res.json({
        success: true,
        message: 'Batch processing paused',
      });
    } catch (error) {
      logger.error('Failed to pause batch:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to pause batch processing',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Resume batch processing
 */
export const resumeBatch = [
  param('pipelineId').isString().notEmpty(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { pipelineId } = req.params;

      await BatchProcessor.resumeBatch(pipelineId);

      logger.info('Batch processing resumed', { pipelineId });

      res.json({
        success: true,
        message: 'Batch processing resumed',
      });
    } catch (error) {
      logger.error('Failed to resume batch:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resume batch processing',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Get all active batches
 */
export const getActiveBatches = async (_req: Request, res: Response): Promise<void> => {
  try {
    const batches = await BatchProcessor.getActiveBatches();

    res.json({
      success: true,
      data: batches,
    });
  } catch (error) {
    logger.error('Failed to get active batches:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get active batches',
      details: (error as Error).message,
    });
  }
};

/**
 * Add individual brand discovery job
 */
export const addBrandDiscovery = [
  body('athleteId').isUUID().withMessage('athleteId must be a valid UUID'),
  body('athleteName').isString().notEmpty().withMessage('athleteName is required'),
  body('sport').optional().isString(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { athleteId, athleteName, sport } = req.body;
      const userId = req.user?.id;

      const job = await addBrandDiscoveryJob({
        athleteId,
        athleteName,
        sport,
        userId,
      });

      logger.info('Brand discovery job added', { jobId: job.id, athleteId });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          athleteId,
          status: 'queued',
        },
      });
    } catch (error) {
      logger.error('Failed to add brand discovery job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add brand discovery job',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Add verification job
 */
export const addVerification = [
  body('athleteId').isUUID(),
  body('brandIds').isArray({ min: 1 }),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { athleteId, brandIds } = req.body;
      const userId = req.user?.id;

      const job = await addVerificationJob({
        athleteId,
        brandIds,
        userId,
      });

      logger.info('Verification job added', { jobId: job.id, athleteId });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          athleteId,
          brandCount: brandIds.length,
          status: 'queued',
        },
      });
    } catch (error) {
      logger.error('Failed to add verification job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add verification job',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Add metrics job
 */
export const addMetrics = [
  body('brandId').isUUID(),
  body('brandName').isString().notEmpty(),
  body('socialProfiles').isObject(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { brandId, brandName, socialProfiles } = req.body;
      const userId = req.user?.id;

      const job = await addMetricsJob({
        brandId,
        brandName,
        socialProfiles,
        userId,
      });

      logger.info('Metrics job added', { jobId: job.id, brandId });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          brandId,
          status: 'queued',
        },
      });
    } catch (error) {
      logger.error('Failed to add metrics job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add metrics job',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Add scoring job
 */
export const addScoring = [
  body('athleteId').isUUID(),
  body('brandIds').isArray({ min: 1 }),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { athleteId, brandIds, recalculateAll } = req.body;
      const userId = req.user?.id;

      const job = await addScoringJob({
        athleteId,
        brandIds,
        recalculateAll,
        userId,
      });

      logger.info('Scoring job added', { jobId: job.id, athleteId });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          athleteId,
          brandCount: brandIds.length,
          status: 'queued',
        },
      });
    } catch (error) {
      logger.error('Failed to add scoring job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add scoring job',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Get job status
 */
export const getJobStatus = [
  param('jobId').isString().notEmpty(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params;

      const jobStatus = await jobMonitor.getJobStatus(jobId);

      if (!jobStatus) {
        res.status(404).json({
          success: false,
          error: 'Job not found',
        });
        return;
      }

      res.json({
        success: true,
        data: jobStatus,
      });
    } catch (error) {
      logger.error('Failed to get job status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get job status',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Delete/cancel job
 */
export const deleteJob = [
  param('jobId').isString().notEmpty(),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params;

      logger.info('Job deletion requested', { jobId });

      res.json({
        success: true,
        message: `Job ${jobId} marked for deletion`,
      });
    } catch (error) {
      logger.error('Failed to delete job:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete job',
        details: (error as Error).message,
      });
    }
  },
];

/**
 * Get queue statistics
 */
export const getQueueStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const queueStatuses = await getQueueStatuses();

    res.json({
      success: true,
      data: {
        queues: queueStatuses,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    logger.error('Failed to get queue stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue statistics',
      details: (error as Error).message,
    });
  }
};

/**
 * Get monitoring metrics
 */
export const getMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await jobMonitor.collectMetrics();

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    logger.error('Failed to get metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get monitoring metrics',
      details: (error as Error).message,
    });
  }
};

/**
 * Get scheduler status
 */
export const getSchedulerJobStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = getSchedulerStatus();

    res.json({
      success: true,
      data: status,
      message: 'Scheduler status retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to get scheduler status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get scheduler status',
      details: (error as Error).message,
    });
  }
};

/**
 * Trigger scheduled job
 */
export const triggerSchedulerJob = [
  param('jobName')
    .isIn(['brand-discovery', 'metrics-collection', 'scoring-recalculation', 'data-quality-check'])
    .withMessage('Invalid job name'),

  async (req: Request, res: Response): Promise<void> => {
    const { jobName } = req.params;

    try {
      logger.info(`Manually triggering scheduled job: ${jobName}`, {
        userId: req.user?.id,
        correlationId: req.correlationId,
      });

      // Trigger the job asynchronously
      triggerScheduledJob(jobName as any).catch(error => {
        logger.error(`Scheduled job ${jobName} failed:`, error);
      });

      res.json({
        success: true,
        message: `Scheduled job "${jobName}" triggered successfully`,
        data: {
          jobName,
          triggeredAt: new Date().toISOString(),
          note: 'Job is running asynchronously. Check logs for progress.',
        },
      });
    } catch (error) {
      logger.error(`Failed to trigger scheduled job ${jobName}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to trigger scheduled job ${jobName}`,
        details: (error as Error).message,
      });
    }
  },
];
