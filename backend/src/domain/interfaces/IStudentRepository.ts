import { Student } from '../entities/Student.js';

export interface IStudentRepository {
  save(student: Student): Promise<Student>;
  findById(id: string): Promise<Student | null>;
  findByUserId(userId: string): Promise<Student | null>;
  findAll(limit: number, offset: number): Promise<Student[]>;
  delete(id: string): Promise<void>;
}
