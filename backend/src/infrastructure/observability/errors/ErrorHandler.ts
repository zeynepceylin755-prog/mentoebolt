import { Request, Response, NextFunction } from 'express';

export function observabilityErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = (req as any).requestId;
  
  // Log error
  console.error({
    event: 'error',
    path: req.path,
    method: req.method,
    requestId,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  });
  
  // Don't expose stack traces in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred',
      requestId,
      ...(isDevelopment && { stack: err.stack }),
    },
  });
}
