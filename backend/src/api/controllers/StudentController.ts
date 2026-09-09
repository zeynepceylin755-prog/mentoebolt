import { Request, Response, NextFunction } from 'express';
import { StudentService } from '../../application/services/StudentService.js';
import { AuthRequest } from '../middleware/auth.js';

export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  async createStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const student = await this.studentService.createStudent(req.body);
      res.status(201).json({
        success: true,
        data: student,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.userId!;
      const profile = await this.studentService.getStudentProfileByUserId(userId);
      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  async getStudentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId } = req.params;
      const profile = await this.studentService.getStudentProfile(studentId as string);
      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;
      
      const students = await this.studentService.getAllStudents(limit, offset);
      res.json({
        success: true,
        data: students,
        meta: {
          page,
          limit,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStudentGrade(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId } = req.params;
      const { grade } = req.body;
      const student = await this.studentService.updateStudentGrade(studentId as string, grade);
      res.json({
        success: true,
        data: student,
      });
    } catch (error) {
      next(error);
    }
  }
}
