/**
 * Job Service Type Definitions
 */

// Job data types
export interface BrandDiscoveryJobData {
  athleteId: string;
  athleteName: string;
  sport?: string;
  userId?: string;
  batchId?: string;
}

export interface VerificationJobData {
  athleteId: string;
  brandIds: string[];
  userId?: string;
  batchId?: string;
}

export interface MetricsJobData {
  brandId: string;
  brandName: string;
  socialProfiles: Record<string, string>;
  userId?: string;
  batchId?: string;
}

export interface ScoringJobData {
  athleteId: string;
  brandIds: string[];
  recalculateAll?: boolean;
  userId?: string;
  batchId?: string;
}

export interface PipelineJobData {
  athleteIds: string[];
  pipelineId: string;
  userId: string;
  options?: {
    skipVerification?: boolean;
    skipMetrics?: boolean;
    skipScoring?: boolean;
    concurrency?: number;
  };
}

// Queue status types
export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

// Pipeline types
export interface PipelineStatus {
  pipelineId: string;
  athleteIds: string[];
  status: 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  createdAt: Date;
  userId: string;
}

// Job result types
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  processingTime: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  details?: any;
}

// User context (from JWT)
export interface UserContext {
  id: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
      correlationId?: string;
    }
  }
}
