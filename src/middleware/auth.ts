/**
 * Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Middleware to validate service API key for inter-service communication
 */
export function requireServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-service-api-key'] as string;

  if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
    logger.warn('Invalid service API key attempt', {
      ip: req.ip,
      path: req.path,
    });

    res.status(403).json({
      success: false,
      error: 'Invalid service API key',
    });
    return;
  }

  next();
}

/**
 * Middleware to add correlation ID to requests
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = (req.headers['x-correlation-id'] as string) ||
    `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

/**
 * Optional user context middleware (for user-facing endpoints)
 */
export function optionalUserContext(req: Request, res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;
  const userRole = req.headers['x-user-role'] as string;

  if (userId) {
    req.user = {
      id: userId,
      email: userEmail || '',
      role: userRole || 'user',
    };
  }

  next();
}
