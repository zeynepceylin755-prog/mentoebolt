import { Student } from '../../domain/entities/Student.js';
import { User } from '../../domain/entities/User.js';
import { NotFoundError } from '../../domain/errors/NotFoundError.js';
import { ValidationError } from '../../domain/errors/ValidationError.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface CreateStudentDTO {
  email: string;
  firstName: string;
  lastName: string;
  grade: number;
  school?: string;
}

export interface StudentProfileDTO {
  id: string;
  fullName: string;
  email: string;
  grade: number;
  school?: string;
  learningProfileId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class StudentService {
  constructor(
    private readonly studentRepository: IStudentRepository,
    private readonly userRepository: IUserRepository
  ) {}
  
  async createStudent(dto: CreateStudentDTO): Promise<StudentProfileDTO> {
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ValidationError('User with this email already exists');
    }
    
    const user = User.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: 'STUDENT',
      emailVerified: false,
    });
    
    const savedUser = await this.userRepository.save(user);
    
    const student = Student.create({
      userId: savedUser.id,
      grade: dto.grade,
      school: dto.school,
    });
    
    const savedStudent = await this.studentRepository.save(student);
    
    logger.info({ studentId: savedStudent.id, userId: savedUser.id }, 'Student created');
    
    return this.toDTO(savedStudent, savedUser);
  }
  
  async getStudentProfile(studentId: string): Promise<StudentProfileDTO> {
    const student = await this.studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError('Student', studentId);
    }
    
    const user = await this.userRepository.findById(student.userId);
    if (!user) {
      throw new NotFoundError('User', student.userId);
    }
    
    return this.toDTO(student, user);
  }

  async getStudentProfileByUserId(userId: string): Promise<StudentProfileDTO> {
    const student = await this.studentRepository.findByUserId(userId);
    if (!student) {
      throw new NotFoundError('Student profile for user', userId);
    }
    
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User', userId);
    }
    
    return this.toDTO(student, user);
  }

  async getAllStudents(limit: number, offset: number): Promise<StudentProfileDTO[]> {
    const students = await this.studentRepository.findAll(limit, offset);
    const result: StudentProfileDTO[] = [];
    
    for (const student of students) {
      const user = await this.userRepository.findById(student.userId);
      if (user) {
        result.push(this.toDTO(student, user));
      }
    }
    
    return result;
  }
  
  async updateStudentGrade(studentId: string, grade: number): Promise<Student> {
    const student = await this.studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError('Student', studentId);
    }
    
    const updatedStudent = Student.create({
      ...student,
      grade,
    });
    
    return this.studentRepository.save(updatedStudent);
  }
  
  private toDTO(student: Student, user: User): StudentProfileDTO {
    return {
      id: student.id,
      fullName: user.fullName,
      email: user.email,
      grade: student.grade,
      school: student.school,
      learningProfileId: student.learningProfileId,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }
}
