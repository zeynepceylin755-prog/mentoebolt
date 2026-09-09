import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';

export class OwnershipGuard {
  constructor(private readonly studentRepository: IStudentRepository) {}

  requireStudentOwnership = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthorizationError('Authentication required');
      }

      const studentId = req.params.studentId || req.params.id;
      
      if (!studentId) {
        const student = await this.studentRepository.findByUserId(req.userId);
        if (!student) {
          throw new AuthorizationError('Student profile not found');
        }
        req.params.studentId = student.id;
        next();
        return;
      }

      const student = await this.studentRepository.findById(studentId);
      if (!student) {
        throw new AuthorizationError('Student not found');
      }

      if (student.userId !== req.userId) {
        if (req.userRole !== 'ADMIN') {
          throw new AuthorizationError('You do not have access to this student\'s data');
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
