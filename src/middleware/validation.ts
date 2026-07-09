/**
 * Request Validation Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import logger from '../utils/logger';

/**
 * Middleware to handle validation errors
 */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      path: req.path,
      errors: errors.array(),
      correlationId: req.correlationId,
    });

    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }

  next();
}

/**
 * Create validation middleware chain
 */
export function validate(validations: ValidationChain[]) {
  return [...validations, handleValidationErrors];
}
