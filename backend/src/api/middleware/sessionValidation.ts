import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { PrismaClient } from '@prisma/client';

export interface SessionValidationRequest extends AuthRequest {
  validatedStudentId?: string;
  validatedSessionId?: string;
}

export class SessionValidationMiddleware {
  constructor(
    private readonly studentRepository: IStudentRepository,
    private readonly prisma: PrismaClient
  ) {}

  /**
   * Validates that the authenticated user has a student profile
   * and sets the studentId in the request
   */
  requireStudentProfile = async (
    req: SessionValidationRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthenticationError('Authentication required');
      }

      const student = await this.studentRepository.findByUserId(req.userId);
      if (!student) {
        throw new AuthorizationError('Student profile not found');
      }

      req.validatedStudentId = student.id;
      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Validates learning session ownership and status
   */
  validateLearningSession = async (
    req: SessionValidationRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthenticationError('Authentication required');
      }

      const sessionId = req.params.sessionId || req.body.sessionId;
      if (!sessionId) {
        throw new AuthenticationError('Session ID is required');
      }

      // Get the learning session
      const session = await this.prisma.learningSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new AuthorizationError('Learning session not found');
      }

      // Verify ownership
      const student = await this.studentRepository.findByUserId(req.userId);
      if (!student || session.studentId !== student.id) {
        throw new AuthorizationError('You do not have access to this learning session');
      }

      // Check expiration
      if (session.expiresAt && new Date() > session.expiresAt) {
        throw new AuthorizationError('Learning session has expired');
      }

      // Check if session is in a valid state for mutations
      const validStatuses = ['ACTIVE'];
      if (req.method !== 'GET' && !validStatuses.includes(session.status)) {
        throw new AuthorizationError(`Cannot modify session with status: ${session.status}`);
      }

      req.validatedSessionId = sessionId;
      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Validates that the studentId in params belongs to the authenticated user
   */
  validateStudentOwnership = async (
    req: SessionValidationRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthenticationError('Authentication required');
      }

      const studentId = req.params.studentId || req.body.studentId;
      if (!studentId) {
        throw new AuthenticationError('Student ID is required');
      }

      const student = await this.studentRepository.findById(studentId);
      if (!student) {
        throw new AuthorizationError('Student not found');
      }

      if (student.userId !== req.userId) {
        throw new AuthorizationError('You do not have access to this student data');
      }

      req.validatedStudentId = studentId;
      next();
    } catch (error) {
      next(error);
    }
  };
}