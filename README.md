# Icon Radar Job Service

Background job processing and scheduling service for the Icon Radar platform.

## Overview

The Job Service manages all background job processing using Bull/Redis queues and handles scheduled tasks with cron jobs. It orchestrates the complete AI agent pipeline for athlete brand discovery, verification, metrics collection, and scoring.

## Features

- **5 Specialized Job Queues**:
  - Brand Discovery Queue (concurrency: 5)
  - Verification Queue (concurrency: 3)
  - Metrics Collection Queue (concurrency: 4)
  - Scoring Queue (concurrency: 2)
  - Pipeline Orchestration Queue (concurrency: 1)

- **Job Processors**:
  - Brand Discovery Processor - Discovers brands for athletes
  - Verification Processor - Verifies ownership relationships
  - Metrics Processor - Collects social media and web metrics
  - Scoring Processor - Calculates Champion Index scores
  - Pipeline Processor - Orchestrates complete workflows

- **Scheduled Tasks**:
  - Daily brand discovery (midnight)
  - Metrics collection every 6 hours
  - Daily Champion Index recalculation (2 AM)
  - Weekly data quality checks (Sunday 3 AM)

- **Monitoring**:
  - Real-time job status tracking
  - Queue statistics and metrics
  - Failed job tracking
  - Scheduler status

## Architecture

```
job-service (Port 3007)
├── Queue Manager (Bull/Redis)
│   ├── brand-discovery-queue
│   ├── verification-queue
│   ├── metrics-queue
│   ├── scoring-queue
│   └── pipeline-queue
├── Job Processors
│   ├── brandDiscoveryProcessor.ts
│   ├── verificationProcessor.ts
│   ├── metricsProcessor.ts
│   ├── scoringProcessor.ts
│   └── pipelineProcessor.ts
├── Scheduler Service (node-cron)
│   ├── scheduledBrandDiscovery
│   ├── scheduledMetricsCollection
│   ├── scheduledScoringRecalculation
│   └── scheduledDataQualityCheck
└── Job Monitor
    ├── Job status tracking
    ├── Queue metrics
    └── Failed job management
```

## API Endpoints

### Batch Processing
- `POST /api/v1/jobs/batch` - Start batch processing
- `GET /api/v1/jobs/batch/:pipelineId` - Get batch status
- `POST /api/v1/jobs/batch/:pipelineId/pause` - Pause batch
- `POST /api/v1/jobs/batch/:pipelineId/resume` - Resume batch
- `GET /api/v1/jobs/batch` - Get all active batches

### Individual Jobs
- `POST /api/v1/jobs/brand-discovery` - Queue brand discovery
- `POST /api/v1/jobs/verification` - Queue verification
- `POST /api/v1/jobs/metrics` - Queue metrics collection
- `POST /api/v1/jobs/scoring` - Queue Champion Index scoring

### Job Management
- `GET /api/v1/jobs/:jobId` - Get job status
- `DELETE /api/v1/jobs/:jobId` - Cancel/delete job

### Monitoring
- `GET /api/v1/jobs/stats/queues` - Queue statistics
- `GET /api/v1/jobs/stats/metrics` - Job metrics

### Scheduler
- `GET /api/v1/jobs/scheduler/status` - Scheduler status
- `POST /api/v1/jobs/scheduler/trigger/:jobName` - Manually trigger scheduled job

### Health
- `GET /health` - Basic health check
- `GET /health/ready` - Readiness probe

## Environment Variables

```bash
# Service Configuration
PORT=3007
SERVICE_NAME=job-service
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/iconradar

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Service Discovery
AUTH_SERVICE_URL=http://localhost:3001
ATHLETE_SERVICE_URL=http://localhost:3002
BRAND_SERVICE_URL=http://localhost:3003
EXTERNAL_APIS_URL=http://localhost:3008
AI_AGENTS_URL=http://localhost:3009

# Security
SERVICE_API_KEY=your-service-api-key-here
JWT_SECRET=your-jwt-secret-here

# Job Configuration
JOB_CONCURRENCY_BRAND_DISCOVERY=5
JOB_CONCURRENCY_VERIFICATION=3
JOB_CONCURRENCY_METRICS=4
JOB_CONCURRENCY_SCORING=2
JOB_CONCURRENCY_PIPELINE=1

# Scheduler Configuration
SCHEDULER_TIMEZONE=America/New_York
SCHEDULER_ENABLED=true

# Logging
LOG_LEVEL=info
```

## Installation

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your configuration

# Build
npm run build

# Development
npm run dev

# Production
npm start
```

## Docker

```bash
# Build image
docker build -t icon-radar-job-service .

# Run container
docker run -p 3007:3007 --env-file .env icon-radar-job-service
```

## Usage Examples

### Start Batch Processing

```bash
curl -X POST http://localhost:3007/api/v1/jobs/batch \
  -H "Content-Type: application/json" \
  -H "x-service-api-key: your-key" \
  -d '{
    "athleteIds": ["uuid1", "uuid2", "uuid3"],
    "options": {
      "concurrency": 5,
      "skipVerification": false,
      "skipMetrics": false,
      "skipScoring": false
    }
  }'
```

### Get Job Status

```bash
curl http://localhost:3007/api/v1/jobs/{jobId} \
  -H "x-service-api-key: your-key"
```

### Queue Brand Discovery

```bash
curl -X POST http://localhost:3007/api/v1/jobs/brand-discovery \
  -H "Content-Type: application/json" \
  -H "x-service-api-key: your-key" \
  -d '{
    "athleteId": "uuid",
    "athleteName": "LeBron James",
    "sport": "Basketball"
  }'
```

### Get Queue Statistics

```bash
curl http://localhost:3007/api/v1/jobs/stats/queues \
  -H "x-service-api-key: your-key"
```

### Trigger Scheduled Job

```bash
curl -X POST http://localhost:3007/api/v1/jobs/scheduler/trigger/brand-discovery \
  -H "x-service-api-key: your-key"
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Development

```bash
# Start in development mode with auto-reload
npm run dev

# Lint code
npm run lint

# Format code
npm run format
```

## Job Retry Logic

All jobs include automatic retry logic with exponential backoff:

- **Brand Discovery**: 3 attempts, 2s initial delay
- **Verification**: 2 attempts, 5s initial delay
- **Metrics Collection**: 3 attempts, 3s initial delay
- **Scoring**: 2 attempts, 4s initial delay
- **Pipeline**: 1 attempt (no retry, individual steps retry)

## Queue Configuration

Jobs are automatically removed from queues after completion:

- **Completed**: Keep last 50 brand discovery, 25 others
- **Failed**: Keep last 100 brand discovery, 50 others

## Monitoring

The service emits events for real-time monitoring:

- `job:completed` - Job successfully completed
- `job:failed` - Job failed
- `job:stalled` - Job stalled (processing timeout)
- `job:progress` - Job progress update
- `job:active` - Job started processing
- `pipeline:completed` - Pipeline completed
- `pipeline:failed` - Pipeline failed
- `pipeline:batch_completed` - Batch within pipeline completed

## Dependencies

- **express** - HTTP server
- **bull** - Redis-based queue
- **ioredis** - Redis client
- **node-cron** - Cron job scheduler
- **winston** - Logging
- **axios** - HTTP client for service communication
- **express-validator** - Request validation
- **zod** - Schema validation

## License

Proprietary - Icon Radar

## Support

For support, contact the Icon Radar development team.
