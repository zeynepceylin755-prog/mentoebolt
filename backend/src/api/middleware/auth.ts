import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { TokenService } from '../../domain/services/TokenService.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';
import { ISessionRepository } from '../../domain/interfaces/ISessionRepository.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
}

export class AuthMiddleware {
  constructor(
    private readonly tokenService: TokenService,
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: ISessionRepository
  ) {}

  authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthenticationError('Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      const payload = this.tokenService.verifyAccessToken(token);

      const user = await this.userRepository.findById(payload.userId);
      if (!user) {
        throw new AuthenticationError('User not found');
      }

      // Check if user is soft-deleted (if the field exists in the user object)
      if ('deletedAt' in user && user.deletedAt) {
        throw new AuthenticationError('User account has been deleted');
      }

      // Check if user is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AuthenticationError('Account is temporarily locked');
      }

      req.userId = payload.userId;
      req.userRole = payload.role;
      req.userEmail = payload.email;

      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        next(error);
      } else {
        next(new AuthenticationError('Invalid or expired token'));
      }
    }
  };

  /**
   * Best-effort principal resolution for RATE LIMITING only.
   *
   * Phase 5F.8 / A4: rate limiters are mounted ahead of the routers that run
   * `authenticate`, so `req.userId` would otherwise always be unset when the
   * limiter keys a request, collapsing user-based limiting into anonymous/IP
   * behaviour. This middleware runs BEFORE the limiters and populates the
   * principal from a valid bearer token when one is present.
   *
   * It never rejects: a missing or invalid token simply leaves the request
   * unauthenticated, so unauthenticated IP-based protection is fully preserved.
   * Actual access control is still enforced by `authenticate` on the routers
   * themselves, so this cannot weaken authentication. It performs no extra DB
   * work: the signature is verified only.
   */
  resolvePrincipalOptional = (req: AuthRequest, _res: Response, next: NextFunction): void => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = this.tokenService.verifyAccessToken(token);
        req.userId = payload.userId;
        req.userRole = payload.role;
        req.userEmail = payload.email;
      }
    } catch {
      // Invalid/expired token: stay anonymous for rate-limiting purposes. The
      // route-level authenticator will reject it with a proper 401.
    }
    next();
  };

  authenticateWithSession = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // First perform standard authentication
      await this.authenticate(req, res, () => {});

      // Now validate session existence and expiration
      const userId = req.userId!;
      
      // Get user's active sessions
      const sessions = await this.sessionRepository.findByUserId(userId);
      const activeSession = sessions.find(session => session.isActive());

      if (!activeSession) {
        throw new AuthenticationError('No active session found. Please login again.');
      }

      // Update session activity
      await this.sessionRepository.save(activeSession.updateActivity());

      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        next(error);
      } else {
        next(new AuthenticationError('Session validation failed'));
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
        next(new AuthorizationError('Insufficient permissions'));
        return;
      }

      next();
    };
  };
}
