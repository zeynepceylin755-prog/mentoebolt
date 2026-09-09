
// backend/src/domain/interfaces/IQuestionAttemptRepository.ts
import { QuestionAttempt } from '../entities/QuestionAttempt.js';

export interface IQuestionAttemptRepository {
  save(attempt: QuestionAttempt): Promise<QuestionAttempt>;
  findById(id: string): Promise<QuestionAttempt | null>;
  findByStudentId(studentId: string, limit?: number): Promise<QuestionAttempt[]>;
  findByStudentAndSkill(studentId: string, skillId: string): Promise<QuestionAttempt[]>;
  findRecentErrors(studentId: string, days: number): Promise<QuestionAttempt[]>;
  findAll(limit: number, offset: number): Promise<QuestionAttempt[]>;
}