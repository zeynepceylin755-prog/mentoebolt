import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { TokenService } from '../../domain/services/TokenService.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
}

export class AuthMiddleware {
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
      const payload = this.tokenService.verifyAccessToken(token);

      const user = await this.userRepository.findById(payload.userId);
      if (!user) {
        throw new AuthenticationError('User not found');
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
