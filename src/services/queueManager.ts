/**
 * Queue Manager Service
 * Manages Bull queues for background job processing
 */

import Queue, { Job, JobOptions } from 'bull';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import {
  BrandDiscoveryJobData,
  VerificationJobData,
  MetricsJobData,
  ScoringJobData,
  PipelineJobData,
  QueueStatus,
  PipelineStatus,
} from '../types';

// Redis configuration
const redisConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },
};

// Queue configurations
const queueConfigs = {
  brandDiscovery: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000,
    },
  },
  verification: {
    removeOnComplete: 25,
    removeOnFail: 50,
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 5000,
    },
  },
  metrics: {
    removeOnComplete: 25,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 3000,
    },
  },
  scoring: {
    removeOnComplete: 25,
    removeOnFail: 50,
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 4000,
    },
  },
  pipeline: {
    removeOnComplete: 10,
    removeOnFail: 25,
    attempts: 1,
  },
};

// Queue instances
export const brandDiscoveryQueue = new Queue<BrandDiscoveryJobData>('brand-discovery', {
  ...redisConfig,
  defaultJobOptions: queueConfigs.brandDiscovery,
});

export const verificationQueue = new Queue<VerificationJobData>('verification', {
  ...redisConfig,
  defaultJobOptions: queueConfigs.verification,
});

export const metricsQueue = new Queue<MetricsJobData>('metrics', {
  ...redisConfig,
  defaultJobOptions: queueConfigs.metrics,
});

export const scoringQueue = new Queue<ScoringJobData>('scoring', {
  ...redisConfig,
  defaultJobOptions: queueConfigs.scoring,
});

export const pipelineQueue = new Queue<PipelineJobData>('pipeline', {
  ...redisConfig,
  defaultJobOptions: queueConfigs.pipeline,
});

// All queues for management
export const allQueues = [
  brandDiscoveryQueue,
  verificationQueue,
  metricsQueue,
  scoringQueue,
  pipelineQueue,
];

// Event emitter for real-time updates
export const queueEventEmitter = new EventEmitter();

// Pipeline orchestration class
export class PipelineOrchestrator {
  private static instance: PipelineOrchestrator;
  private activePipelines: Map<string, PipelineStatus> = new Map();

  static getInstance(): PipelineOrchestrator {
    if (!PipelineOrchestrator.instance) {
      PipelineOrchestrator.instance = new PipelineOrchestrator();
    }
    return PipelineOrchestrator.instance;
  }

  async startPipeline(data: PipelineJobData): Promise<string> {
    const pipelineId = data.pipelineId;

    this.activePipelines.set(pipelineId, {
      pipelineId,
      athleteIds: data.athleteIds,
      status: 'running',
      progress: 0,
      createdAt: new Date(),
      userId: data.userId,
    });

    await pipelineQueue.add('process-pipeline', data, {
      jobId: pipelineId,
      priority: 1,
    });

    return pipelineId;
  }

  async pausePipeline(pipelineId: string): Promise<void> {
    const pipeline = this.activePipelines.get(pipelineId);
    if (pipeline) {
      pipeline.status = 'paused';
      await pipelineQueue.pause();
      queueEventEmitter.emit('pipeline:paused', { pipelineId });
    }
  }

  async resumePipeline(pipelineId: string): Promise<void> {
    const pipeline = this.activePipelines.get(pipelineId);
    if (pipeline) {
      pipeline.status = 'running';
      await pipelineQueue.resume();
      queueEventEmitter.emit('pipeline:resumed', { pipelineId });
    }
  }

  getPipelineStatus(pipelineId: string): PipelineStatus | undefined {
    return this.activePipelines.get(pipelineId);
  }

  getAllPipelines(): PipelineStatus[] {
    return Array.from(this.activePipelines.values());
  }
}

// Job creation functions
export async function addBrandDiscoveryJob(data: BrandDiscoveryJobData): Promise<Job<BrandDiscoveryJobData>> {
  const job = await brandDiscoveryQueue.add('discover-brands', data, {
    priority: 2,
  });

  logger.info('Brand discovery job added', {
    jobId: job.id,
    athleteId: data.athleteId,
    athleteName: data.athleteName,
  });

  return job;
}

export async function addVerificationJob(data: VerificationJobData): Promise<Job<VerificationJobData>> {
  const job = await verificationQueue.add('verify-ownership', data, {
    priority: 2,
  });

  logger.info('Verification job added', {
    jobId: job.id,
    athleteId: data.athleteId,
    brandCount: data.brandIds.length,
  });

  return job;
}

export async function addMetricsJob(data: MetricsJobData): Promise<Job<MetricsJobData>> {
  const job = await metricsQueue.add('collect-metrics', data, {
    priority: 3,
  });

  logger.info('Metrics job added', {
    jobId: job.id,
    brandId: data.brandId,
    brandName: data.brandName,
  });

  return job;
}

export async function addScoringJob(data: ScoringJobData): Promise<Job<ScoringJobData>> {
  const job = await scoringQueue.add('calculate-index', data, {
    priority: 3,
  });

  logger.info('Scoring job added', {
    jobId: job.id,
    athleteId: data.athleteId,
    brandCount: data.brandIds.length,
  });

  return job;
}

// Queue status functions
export async function getQueueStatuses(): Promise<QueueStatus[]> {
  const statuses = await Promise.all(
    allQueues.map(async (queue) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      const isPaused = await queue.isPaused();

      return {
        name: queue.name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused,
      };
    })
  );

  return statuses;
}

// Setup event listeners
export function setupQueueEventListeners(): void {
  allQueues.forEach((queue) => {
    queue.on('completed', async (job: Job) => {
      logger.info(`Job completed: ${job.queue.name} - ${job.id}`, {
        jobId: job.id,
        queueName: job.queue.name,
        duration: Date.now() - job.timestamp,
      });

      queueEventEmitter.emit('job:completed', {
        jobId: job.id,
        queueName: job.queue.name,
        result: job.returnvalue,
      });
    });

    queue.on('failed', async (job: Job, err: Error) => {
      logger.error(`Job failed: ${job.queue.name} - ${job.id}`, {
        jobId: job.id,
        queueName: job.queue.name,
        error: err.message,
        stack: err.stack,
        attempt: job.attemptsMade,
      });

      queueEventEmitter.emit('job:failed', {
        jobId: job.id,
        queueName: job.queue.name,
        error: err.message,
      });
    });

    queue.on('stalled', async (job: Job) => {
      logger.warn(`Job stalled: ${job.queue.name} - ${job.id}`, {
        jobId: job.id,
        queueName: job.queue.name,
      });

      queueEventEmitter.emit('job:stalled', {
        jobId: job.id,
        queueName: job.queue.name,
      });
    });

    queue.on('progress', (job: Job, progress: number) => {
      logger.debug(`Job progress: ${job.queue.name} - ${job.id}: ${progress}%`);

      queueEventEmitter.emit('job:progress', {
        jobId: job.id,
        queueName: job.queue.name,
        progress,
      });
    });

    queue.on('active', async (job: Job) => {
      logger.info(`Job started: ${job.queue.name} - ${job.id}`);

      queueEventEmitter.emit('job:active', {
        jobId: job.id,
        queueName: job.queue.name,
      });
    });
  });

  logger.info('Queue event listeners initialized');
}

// Batch processing helper
export class BatchProcessor {
  static async processAthletesBatch(
    athleteIds: string[],
    userId: string,
    options: {
      skipVerification?: boolean;
      skipMetrics?: boolean;
      skipScoring?: boolean;
      concurrency?: number;
    } = {}
  ): Promise<string> {
    const pipelineId = `pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const orchestrator = PipelineOrchestrator.getInstance();
    await orchestrator.startPipeline({
      pipelineId,
      athleteIds,
      userId,
      options,
    });

    return pipelineId;
  }

  static async pauseBatch(pipelineId: string): Promise<void> {
    const orchestrator = PipelineOrchestrator.getInstance();
    await orchestrator.pausePipeline(pipelineId);
  }

  static async resumeBatch(pipelineId: string): Promise<void> {
    const orchestrator = PipelineOrchestrator.getInstance();
    await orchestrator.resumePipeline(pipelineId);
  }

  static async getActiveBatches(): Promise<PipelineStatus[]> {
    const orchestrator = PipelineOrchestrator.getInstance();
    return orchestrator.getAllPipelines();
  }
}

// Cleanup function
export async function closeQueues(): Promise<void> {
  logger.info('Closing all queues...');

  await Promise.all(allQueues.map((queue) => queue.close()));

  logger.info('All queues closed');
}
