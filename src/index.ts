/**
 * Job Service Entry Point
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { correlationId, requireServiceAuth, optionalUserContext } from './middleware/auth';
import jobsRouter from './routes/jobs';
import { setupQueueEventListeners, closeQueues } from './services/queueManager';
import { initializeScheduler, shutdownScheduler } from './services/schedulerService';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3007;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(correlationId);

// Health check endpoints
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: process.env.SERVICE_NAME || 'job-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/health/ready', async (req: Request, res: Response) => {
  try {
    // Check if queues are accessible
    const health = {
      status: 'ready',
      service: process.env.SERVICE_NAME || 'job-service',
      timestamp: new Date().toISOString(),
      checks: {
        redis: 'healthy',
        queues: 'ready',
        scheduler: process.env.SCHEDULER_ENABLED === 'true' ? 'running' : 'disabled',
      },
    };

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: (error as Error).message,
    });
  }
});

// API routes
app.use('/api/v1/jobs', optionalUserContext, requireServiceAuth, jobsRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.path,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    correlationId: req.correlationId,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Initialize service
async function startServer() {
  try {
    logger.info('Starting Job Service...', {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
    });

    // Load all job processors
    logger.info('Loading job processors...');
    await import('./processors/brandDiscoveryProcessor');
    await import('./processors/verificationProcessor');
    await import('./processors/metricsProcessor');
    await import('./processors/scoringProcessor');
    await import('./processors/pipelineProcessor');
    logger.info('All job processors loaded successfully');

    // Setup queue event listeners
    setupQueueEventListeners();

    // Initialize scheduler
    if (process.env.SCHEDULER_ENABLED === 'true') {
      initializeScheduler();
    } else {
      logger.info('Scheduler is disabled');
    }

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`Job Service started successfully`, {
        port: PORT,
        url: `http://localhost:${PORT}`,
        health: `http://localhost:${PORT}/health`,
        api: `http://localhost:${PORT}/api/v1/jobs`,
      });
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutdown signal received, closing gracefully...');

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      // Shutdown scheduler
      if (process.env.SCHEDULER_ENABLED === 'true') {
        shutdownScheduler();
      }

      // Close queues
      await closeQueues();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection:', { reason, promise });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start Job Service:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
