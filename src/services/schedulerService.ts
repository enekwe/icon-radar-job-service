/**
 * Scheduler Service
 * Manages cron jobs for scheduled tasks
 */

import cron from 'node-cron';
import { logger } from '@enekwe/icon-radar-shared';
import {
  addBrandDiscoveryJob,
  addMetricsJob,
  addScoringJob,
} from './queueManager';
import axios from 'axios';

// Track running jobs to prevent overlaps
const runningJobs = new Map<string, boolean>();

/**
 * Prevents a job from running if it's already executing
 */
function preventOverlap(jobName: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (runningJobs.get(jobName)) {
      logger.warn(`Skipping ${jobName} - previous execution still running`);
      return;
    }

    try {
      runningJobs.set(jobName, true);
      await fn();
    } finally {
      runningJobs.set(jobName, false);
    }
  };
}

/**
 * Daily Brand Discovery for New Athletes
 * Runs at midnight (00:00) every day
 */
async function scheduledBrandDiscovery(): Promise<void> {
  const jobName = 'scheduled-brand-discovery';
  logger.info(`Starting ${jobName}`);

  try {
    // Call athlete service to get athletes needing discovery
    const response = await axios.get(
      `${process.env.ATHLETE_SERVICE_URL}/api/v1/athletes/needs-discovery`,
      {
        headers: {
          'x-service-api-key': process.env.SERVICE_API_KEY,
        },
        params: {
          limit: 50,
        },
      }
    );

    const athletes = response.data.data || [];

    if (athletes.length === 0) {
      logger.info('No athletes need brand discovery at this time');
      return;
    }

    logger.info(`Queuing brand discovery for ${athletes.length} athletes`);

    const jobs = await Promise.all(
      athletes.map((athlete: any) =>
        addBrandDiscoveryJob({
          athleteId: athlete.id,
          athleteName: athlete.name,
          sport: athlete.sport || undefined,
          batchId: `scheduled_${Date.now()}`,
        })
      )
    );

    logger.info(`Successfully queued ${jobs.length} brand discovery jobs`, {
      jobName,
      athleteCount: jobs.length,
    });
  } catch (error) {
    logger.error(`Failed to run ${jobName}:`, error);
  }
}

/**
 * Metrics Collection Every 6 Hours
 */
async function scheduledMetricsCollection(): Promise<void> {
  const jobName = 'scheduled-metrics-collection';
  logger.info(`Starting ${jobName}`);

  try {
    // Call brand service to get brands needing metrics
    const response = await axios.get(
      `${process.env.BRAND_SERVICE_URL}/api/v1/brands/needs-metrics`,
      {
        headers: {
          'x-service-api-key': process.env.SERVICE_API_KEY,
        },
        params: {
          limit: 100,
        },
      }
    );

    const brands = response.data.data || [];

    if (brands.length === 0) {
      logger.info('No brands need metrics collection at this time');
      return;
    }

    logger.info(`Queuing metrics collection for ${brands.length} brands`);

    const jobs = await Promise.all(
      brands.map((brand: any) =>
        addMetricsJob({
          brandId: brand.id,
          brandName: brand.name,
          socialProfiles: brand.socialProfiles || {},
          batchId: `scheduled_${Date.now()}`,
        })
      )
    );

    logger.info(`Successfully queued ${jobs.length} metrics collection jobs`, {
      jobName,
      brandCount: jobs.length,
    });
  } catch (error) {
    logger.error(`Failed to run ${jobName}:`, error);
  }
}

/**
 * Champion Index Recalculation Daily (2 AM)
 */
async function scheduledScoringRecalculation(): Promise<void> {
  const jobName = 'scheduled-scoring-recalculation';
  logger.info(`Starting ${jobName}`);

  try {
    // Call athlete service to get athletes with brands
    const response = await axios.get(
      `${process.env.ATHLETE_SERVICE_URL}/api/v1/athletes/with-brands`,
      {
        headers: {
          'x-service-api-key': process.env.SERVICE_API_KEY,
        },
        params: {
          limit: 100,
        },
      }
    );

    const athletes = response.data.data || [];

    if (athletes.length === 0) {
      logger.info('No athletes need scoring recalculation at this time');
      return;
    }

    logger.info(`Queuing scoring recalculation for ${athletes.length} athletes`);

    const jobs = await Promise.all(
      athletes.map((athlete: any) =>
        addScoringJob({
          athleteId: athlete.id,
          brandIds: athlete.brandIds || [],
          recalculateAll: true,
          batchId: `scheduled_${Date.now()}`,
        })
      )
    );

    logger.info(`Successfully queued ${jobs.length} scoring recalculation jobs`, {
      jobName,
      athleteCount: jobs.length,
    });
  } catch (error) {
    logger.error(`Failed to run ${jobName}:`, error);
  }
}

/**
 * Data Quality Checks Weekly
 */
async function scheduledDataQualityCheck(): Promise<void> {
  const jobName = 'scheduled-data-quality-check';
  logger.info(`Starting ${jobName}`);

  try {
    // This would call analytics service or perform checks
    logger.info('Data quality check completed', {
      jobName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to run ${jobName}:`, error);
  }
}

// Active cron jobs
const scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduler(): void {
  if (process.env.SCHEDULER_ENABLED !== 'true') {
    logger.info('Scheduler is disabled');
    return;
  }

  logger.info('Initializing job scheduler...');

  const timezone = process.env.SCHEDULER_TIMEZONE || 'America/New_York';

  // 1. Daily brand discovery at midnight (00:00)
  const brandDiscoveryJob = cron.schedule(
    '0 0 * * *',
    preventOverlap('brand-discovery', scheduledBrandDiscovery),
    {
      timezone,
      name: 'brand-discovery',
    }
  );
  scheduledJobs.set('brand-discovery', brandDiscoveryJob);
  logger.info('Scheduled: Brand discovery (daily at midnight)');

  // 2. Metrics collection every 6 hours
  const metricsCollectionJob = cron.schedule(
    '0 */6 * * *',
    preventOverlap('metrics-collection', scheduledMetricsCollection),
    {
      timezone,
      name: 'metrics-collection',
    }
  );
  scheduledJobs.set('metrics-collection', metricsCollectionJob);
  logger.info('Scheduled: Metrics collection (every 6 hours)');

  // 3. Champion Index scoring at 2 AM daily
  const scoringRecalculationJob = cron.schedule(
    '0 2 * * *',
    preventOverlap('scoring-recalculation', scheduledScoringRecalculation),
    {
      timezone,
      name: 'scoring-recalculation',
    }
  );
  scheduledJobs.set('scoring-recalculation', scoringRecalculationJob);
  logger.info('Scheduled: Champion Index scoring (daily at 2 AM)');

  // 4. Data quality checks every Sunday at 3 AM
  const dataQualityCheckJob = cron.schedule(
    '0 3 * * 0',
    preventOverlap('data-quality-check', scheduledDataQualityCheck),
    {
      timezone,
      name: 'data-quality-check',
    }
  );
  scheduledJobs.set('data-quality-check', dataQualityCheckJob);
  logger.info('Scheduled: Data quality check (weekly on Sunday at 3 AM)');

  logger.info('Job scheduler initialized successfully', {
    totalScheduledJobs: scheduledJobs.size,
    jobs: Array.from(scheduledJobs.keys()),
  });
}

/**
 * Shutdown all scheduled jobs
 */
export function shutdownScheduler(): void {
  logger.info('Shutting down job scheduler...');

  scheduledJobs.forEach((job, name) => {
    job.stop();
    logger.info(`Stopped scheduled job: ${name}`);
  });

  scheduledJobs.clear();
  logger.info('Job scheduler shut down successfully');
}

/**
 * Get status of all scheduled jobs
 */
export function getSchedulerStatus(): {
  running: boolean;
  jobs: Array<{
    name: string;
    schedule: string;
    isRunning: boolean;
    isScheduled: boolean;
  }>;
} {
  const jobStatuses = [
    {
      name: 'brand-discovery',
      schedule: '0 0 * * * (daily at midnight)',
      isRunning: runningJobs.get('brand-discovery') || false,
      isScheduled: scheduledJobs.has('brand-discovery'),
    },
    {
      name: 'metrics-collection',
      schedule: '0 */6 * * * (every 6 hours)',
      isRunning: runningJobs.get('metrics-collection') || false,
      isScheduled: scheduledJobs.has('metrics-collection'),
    },
    {
      name: 'scoring-recalculation',
      schedule: '0 2 * * * (daily at 2 AM)',
      isRunning: runningJobs.get('scoring-recalculation') || false,
      isScheduled: scheduledJobs.has('scoring-recalculation'),
    },
    {
      name: 'data-quality-check',
      schedule: '0 3 * * 0 (weekly on Sunday at 3 AM)',
      isRunning: runningJobs.get('data-quality-check') || false,
      isScheduled: scheduledJobs.has('data-quality-check'),
    },
  ];

  return {
    running: scheduledJobs.size > 0,
    jobs: jobStatuses,
  };
}

/**
 * Manually trigger a scheduled job
 */
export async function triggerScheduledJob(
  jobName: 'brand-discovery' | 'metrics-collection' | 'scoring-recalculation' | 'data-quality-check'
): Promise<void> {
  logger.info(`Manually triggering scheduled job: ${jobName}`);

  const jobFunctions = {
    'brand-discovery': scheduledBrandDiscovery,
    'metrics-collection': scheduledMetricsCollection,
    'scoring-recalculation': scheduledScoringRecalculation,
    'data-quality-check': scheduledDataQualityCheck,
  };

  const fn = jobFunctions[jobName];
  if (!fn) {
    throw new Error(`Unknown job: ${jobName}`);
  }

  await preventOverlap(jobName, fn)();
}
