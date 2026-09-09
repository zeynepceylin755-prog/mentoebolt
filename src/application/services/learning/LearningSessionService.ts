import { PrismaClient } from '@prisma/client';
import { IStudentRepository } from '../../../domain/interfaces/IStudentRepository.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface StartSessionDTO {
  studentId: string;
  sessionType?: 'PRACTICE' | 'ASSESSMENT' | 'DIAGNOSTIC' | 'REVIEW';
  title?: string;
}

export class LearningSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly studentRepository: IStudentRepository
  ) {}

  async startSession(dto: StartSessionDTO): Promise<any> {
    const student = await this.studentRepository.findById(dto.studentId);
    if (!student) {
      throw new Error('Student not found');
    }

    const session = await this.prisma.learningSession.create({
      data: {
        studentId: dto.studentId,
        sessionType: dto.sessionType || 'PRACTICE',
        status: 'ACTIVE',
        startedAt: new Date(),
        totalQuestions: 0,
        correctAnswers: 0,
      },
    });

    logger.info({ sessionId: session.id, studentId: dto.studentId }, 'Learning session started');
    return session;
  }

  async addQuestionToSession(sessionId: string, questionId: string, order: number): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: { questions: true },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'ACTIVE') {
      throw new Error('Session is not active');
    }

    const existing = session.questions.find(q => q.questionId === questionId);
    if (existing) {
      throw new Error('Question already in session');
    }

    const sessionQuestion = await this.prisma.learningSessionQuestion.create({
      data: {
        sessionId,
        questionId,
        order: order || session.questions.length + 1,
        status: 'PENDING',
      },
    });

    await this.prisma.learningSession.update({
      where: { id: sessionId },
      data: { totalQuestions: { increment: 1 } },
    });

    return sessionQuestion;
  }

  async getSession(sessionId: string): Promise<any> {
    return this.prisma.learningSession.findUnique({
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
  }

  async getActiveSession(studentId: string): Promise<any> {
    return this.prisma.learningSession.findFirst({
      where: {
        studentId,
        status: 'ACTIVE',
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async completeSession(sessionId: string): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'ACTIVE') {
      throw new Error('Session is not active');
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

  async abandonSession(sessionId: string): Promise<any> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'ACTIVE') {
      throw new Error('Session is not active');
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
}
