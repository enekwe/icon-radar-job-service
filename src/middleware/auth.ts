/**
 * Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '@enekwe/icon-radar-shared';

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
 * Optional user context middleware (for user-facing endpoints)
 */
export function optionalUserContext(req: Request, _res: Response, next: NextFunction): void {
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
