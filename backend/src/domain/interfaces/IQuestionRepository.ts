
// backend/src/domain/interfaces/IQuestionRepository.ts
import { Question } from '../entities/Question.js';

export interface IQuestionRepository {
  save(question: Question): Promise<Question>;
  findById(id: string): Promise<Question | null>;
  findBySkillId(skillId: string): Promise<Question[]>;
  findRandomBySkillId(skillId: string, limit: number): Promise<Question[]>;
  findAll(limit: number, offset: number): Promise<Question[]>;
  delete(id: string): Promise<void>;
}