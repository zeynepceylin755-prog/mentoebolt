import { Student } from '../../domain/entities/Student.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';

export class InMemoryStudentRepository implements IStudentRepository {
  private students: Map<string, Student> = new Map();
  
  async save(student: Student): Promise<Student> {
    this.students.set(student.id, student);
    return student;
  }
  
  async findById(id: string): Promise<Student | null> {
    return this.students.get(id) || null;
  }
  
  async findByUserId(userId: string): Promise<Student | null> {
    for (const student of this.students.values()) {
      if (student.userId === userId) {
        return student;
      }
    }
    return null;
  }
  
  async findAll(limit: number, offset: number): Promise<Student[]> {
    const all = Array.from(this.students.values());
    return all.slice(offset, offset + limit);
  }
  
  async delete(id: string): Promise<void> {
    this.students.delete(id);
  }
}
