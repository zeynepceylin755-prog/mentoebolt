import { PrismaClient } from '@prisma/client';
import { IStudentRepository } from '../../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError, AuthorizationError } from '../../../domain/errors/AuthenticationError.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface StartSessionDTO {
  studentId: string;
  sessionType?: 'PRACTICE' | 'ASSESSMENT' | 'DIAGNOSTIC' | 'REVIEW';
  title?: string;
  expiresAt?: Date;
}

export interface AddQuestionDTO {
  sessionId: string;
  questionId: string;
  order: number;
}

export class LearningSessionService {
  // Default session expiration: 2 hours
  private readonly DEFAULT_SESSION_EXPIRATION_HOURS = 2;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly studentRepository: IStudentRepository
  ) {}

  async startSession(dto: StartSessionDTO): Promise<any> {
    const student = await this.studentRepository.findById(dto.studentId);
    if (!student) {
      throw new AuthenticationError('Student not found');
    }

    // Calculate expiration if not provided
    const expiresAt = dto.expiresAt || new Date(Date.now() + this.DEFAULT_SESSION_EXPIRATION_HOURS * 60 * 60 * 1000);

    const session = await this.prisma.learningSession.create({
      data: {
        studentId: dto.studentId,
        sessionType: dto.sessionType || 'PRACTICE',
        status: 'ACTIVE',
        startedAt: new Date(),
        totalQuestions: 0,
        correctAnswers: 0,
        expiresAt,
      },
    });

    logger.info({ sessionId: session.id, studentId: dto.studentId, expiresAt }, 'Learning session started');
    return session;
  }

  async addQuestionToSession(dto: AddQuestionDTO): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: dto.sessionId },
      include: { questions: true },
    });

    if (!session) {
      throw new AuthorizationError('Session not found');
    }

    // Validate session status
    if (session.status !== 'ACTIVE') {
      throw new AuthorizationError('Session is not active');
    }

    // Validate session expiration
    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new AuthorizationError('Session has expired');
    }

    const existing = session.questions.find(q => q.questionId === dto.questionId);
    if (existing) {
      throw new AuthorizationError('Question already in session');
    }

    const sessionQuestion = await this.prisma.learningSessionQuestion.create({
      data: {
        sessionId: dto.sessionId,
        questionId: dto.questionId,
        order: dto.order || session.questions.length + 1,
        status: 'PENDING',
      },
    });

    await this.prisma.learningSession.update({
      where: { id: dto.sessionId },
      data: { totalQuestions: { increment: 1 } },
    });

    return sessionQuestion;
  }

  async getSession(sessionId: string, userId?: string): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          include: {
            question: {
              include: {
                options: true,
              },
            },
          },
        },
        attempts: true,
      },
    });

    if (!session) {
      throw new AuthorizationError('Session not found');
    }

    // If userId is provided, validate ownership
    if (userId) {
      const student = await this.studentRepository.findByUserId(userId);
      if (!student || session.studentId !== student.id) {
        throw new AuthorizationError('You do not have access to this session');
      }
    }

    return session;
  }

  async getActiveSession(studentId: string): Promise<any> {
    const session = await this.prisma.learningSession.findFirst({
      where: {
        studentId,
        status: 'ACTIVE',
      },
      orderBy: { startedAt: 'desc' },
    });

    // Check if session is expired
    if (session && session.expiresAt && new Date() > session.expiresAt) {
      // Auto-expire the session
      await this.prisma.learningSession.update({
        where: { id: session.id },
        data: {
          status: 'EXPIRED',
          endedAt: new Date(),
        },
      });
      return null;
    }

    return session;
  }

  async completeSession(sessionId: string, userId?: string): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AuthorizationError('Session not found');
    }

    // Validate ownership if userId provided
    if (userId) {
      const student = await this.studentRepository.findByUserId(userId);
      if (!student || session.studentId !== student.id) {
        throw new AuthorizationError('You do not have access to this session');
      }
    }

    if (session.status !== 'ACTIVE') {
      throw new AuthorizationError('Session is not active');
    }

    // Validate expiration
    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new AuthorizationError('Session has expired');
    }

    const durationSeconds = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);

    return this.prisma.learningSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        durationSeconds,
      },
    });
  }

  async abandonSession(sessionId: string, userId?: string): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AuthorizationError('Session not found');
    }

    // Validate ownership if userId provided
    if (userId) {
      const student = await this.studentRepository.findByUserId(userId);
      if (!student || session.studentId !== student.id) {
        throw new AuthorizationError('You do not have access to this session');
      }
    }

    if (session.status !== 'ACTIVE') {
      throw new AuthorizationError('Session is not active');
    }

    const durationSeconds = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);

    return this.prisma.learningSession.update({
      where: { id: sessionId },
      data: {
        status: 'ABANDONED',
        endedAt: new Date(),
        durationSeconds,
      },
    });
  }

  /**
   * Validates a learning session for mutations
   * Checks existence, ownership, status, and expiration
   */
  async validateSessionForMutation(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AuthorizationError('Learning session not found');
    }

    // Validate ownership
    const student = await this.studentRepository.findByUserId(userId);
    if (!student || session.studentId !== student.id) {
      throw new AuthorizationError('You do not have access to this learning session');
    }

    // Validate status
    if (session.status !== 'ACTIVE') {
      throw new AuthorizationError(`Cannot modify session with status: ${session.status}`);
    }

    // Validate expiration
    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new AuthorizationError('Learning session has expired');
    }
  }
}
