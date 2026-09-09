import { PrismaClient, StudentProfile as PrismaStudent } from '@prisma/client';
import { Student } from '../../domain/entities/Student.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';

export class PrismaStudentRepository implements IStudentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(student: Student): Promise<Student> {
    const data = {
      id: student.id,
      userId: student.userId,
      grade: student.grade,
      school: student.school,
      learningStage: student.learningStage || 'DISCOVERY',
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };

    const saved = await this.prisma.studentProfile.upsert({
      where: { id: student.id },
      update: data,
      create: data,
    });

    return this.toDomain(saved);
  }

  async findById(id: string): Promise<Student | null> {
    const student = await this.prisma.studentProfile.findUnique({
      where: { id },
    });
    return student ? this.toDomain(student) : null;
  }

  async findByUserId(userId: string): Promise<Student | null> {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });
    return student ? this.toDomain(student) : null;
  }

  async findAll(limit: number, offset: number): Promise<Student[]> {
    const students = await this.prisma.studentProfile.findMany({
      take: limit,
      skip: offset,
    });
    return students.map(s => this.toDomain(s));
  }

  async delete(id: string): Promise<void> {
    await this.prisma.studentProfile.delete({
      where: { id },
    });
  }

  private toDomain(prismaStudent: PrismaStudent): Student {
    return Student.create({
      id: prismaStudent.id,
      userId: prismaStudent.userId,
      grade: prismaStudent.grade,
      school: prismaStudent.school || undefined,
      learningStage: prismaStudent.learningStage || 'DISCOVERY',
      createdAt: prismaStudent.createdAt,
      updatedAt: prismaStudent.updatedAt,
    });
  }
}
