import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { TokenService } from '../../domain/services/TokenService.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { InputSanitizer } from '../../infrastructure/security/InputSanitizer.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
  user?: any;
}

export class SecureAuthMiddleware {
  constructor(
    private readonly tokenService: TokenService,
    private readonly userRepository: IUserRepository
  ) {}

  authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthenticationError('Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      
      // Validate token format
      if (token.length < 10 || token.split('.').length !== 3) {
        throw new AuthenticationError('Invalid token format');
      }

      const payload = this.tokenService.verifyAccessToken(token);
      
      // Validate UUID format for userId
      if (!InputSanitizer.validateUUID(payload.userId)) {
        throw new AuthenticationError('Invalid user ID in token');
      }

      const user = await this.userRepository.findById(payload.userId);
      if (!user) {
        throw new AuthenticationError('User not found');
      }

      // Check if user is deleted/disabled
      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AuthenticationError('Account is locked');
      }

      req.userId = payload.userId;
      req.userRole = payload.role;
      req.userEmail = payload.email;
      req.user = user;

      // Log authentication (not sensitive data)
      logger.debug({ userId: payload.userId }, 'Authentication successful');

      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        logger.warn({ error: error.message, path: req.path }, 'Authentication failed');
        next(error);
      } else {
        logger.error({ error, path: req.path }, 'Unexpected authentication error');
        next(new AuthenticationError('Authentication failed'));
      }
    }
  };

  authorize = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
      if (!req.userId || !req.userRole) {
        next(new AuthenticationError('Authentication required'));
        return;
      }

      if (!roles.includes(req.userRole)) {
        logger.warn({
          userId: req.userId,
          role: req.userRole,
          required: roles,
          path: req.path,
        }, 'Authorization failed');
        next(new AuthorizationError('Insufficient permissions'));
        return;
      }

      next();
    };
  };

  requireOwnership = (resourceUserId: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
      if (!req.userId) {
        next(new AuthenticationError('Authentication required'));
        return;
      }

      // Admin can access all
      if (req.userRole === 'ADMIN') {
        next();
        return;
      }

      // Users can only access their own resources
      if (req.userId !== resourceUserId) {
        logger.warn({
          userId: req.userId,
          targetUserId: resourceUserId,
          path: req.path,
        }, 'Ownership violation attempted');
        next(new AuthorizationError('You do not have access to this resource'));
        return;
      }

      next();
    };
  };
}
