/**
 * Job Routes
 */

import { Router } from 'express';
import { validate } from '../middleware/validation';
import * as jobController from '../controllers/jobController';

const router = Router();

// Batch processing routes
router.post('/batch', validate(jobController.startBatchProcessing as any));
router.get('/batch/:pipelineId', validate(jobController.getBatchStatus as any));
router.post('/batch/:pipelineId/pause', validate(jobController.pauseBatch as any));
router.post('/batch/:pipelineId/resume', validate(jobController.resumeBatch as any));
router.get('/batch', jobController.getActiveBatches);

// Individual job creation routes
router.post('/brand-discovery', validate(jobController.addBrandDiscovery as any));
router.post('/verification', validate(jobController.addVerification as any));
router.post('/metrics', validate(jobController.addMetrics as any));
router.post('/scoring', validate(jobController.addScoring as any));

// Job status routes
router.get('/:jobId', validate(jobController.getJobStatus as any));
router.delete('/:jobId', validate(jobController.deleteJob as any));

// Queue statistics
router.get('/stats/queues', jobController.getQueueStats);
router.get('/stats/metrics', jobController.getMetrics);

// Scheduler routes
router.get('/scheduler/status', jobController.getSchedulerJobStatus);
router.post('/scheduler/trigger/:jobName', validate(jobController.triggerSchedulerJob as any));

export default router;
