import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface SubmitAnswerDTO {
  studentId: string;
  sessionId: string;
  sessionQuestionId?: string;
  questionId: string;
  answer: string;
  timeSpentSeconds: number;
  confidence?: number;
}

export class QuestionAttemptService {
  constructor(private readonly prisma: PrismaClient) {}

  async submitAnswer(dto: SubmitAnswerDTO): Promise<any> {
    const existing = await this.prisma.questionAttempt.findFirst({
      where: {
        studentId: dto.studentId,
        questionId: dto.questionId,
        sessionId: dto.sessionId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const timeSince = Date.now() - new Date(existing.createdAt).getTime();
      if (timeSince < 5000) {
        throw new Error('Duplicate submission detected');
      }
    }

    const question = await this.prisma.question.findUnique({
      where: { id: dto.questionId },
    });

    if (!question) {
      throw new Error('Question not found');
    }

    const isCorrect = this.validateAnswer(question, dto.answer);
    const errorType = isCorrect ? null : this.detectErrorType(question, dto.answer);

    const attempt = await this.prisma.questionAttempt.create({
      data: {
        studentId: dto.studentId,
        questionId: dto.questionId,
        sessionId: dto.sessionId,
        sessionQuestionId: dto.sessionQuestionId,
        answer: dto.answer,
        isCorrect,
        timeSpentSeconds: dto.timeSpentSeconds,
        confidence: dto.confidence,
        errorType,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    if (dto.sessionQuestionId) {
      await this.prisma.learningSessionQuestion.update({
        where: { id: dto.sessionQuestionId },
        data: {
          status: 'ANSWERED',
          answeredAt: new Date(),
        },
      });
    }

    await this.prisma.learningSession.update({
      where: { id: dto.sessionId },
      data: {
        correctAnswers: { increment: isCorrect ? 1 : 0 },
      },
    });

    logger.info({
      attemptId: attempt.id,
      studentId: dto.studentId,
      questionId: dto.questionId,
      isCorrect,
      errorType,
    }, 'Question attempt recorded');

    return {
      attemptId: attempt.id,
      isCorrect,
      correctAnswer: question.correctAnswer,
      errorType,
      attempt,
    };
  }

  private validateAnswer(question: any, answer: string): boolean {
    if (question.type === 'MULTIPLE_CHOICE') {
      return answer.trim() === question.correctAnswer.trim();
    }
    if (question.type === 'CALCULATION') {
      const normalizedAnswer = answer.trim().replace(/\s/g, '');
      const normalizedCorrect = question.correctAnswer.trim().replace(/\s/g, '');
      return normalizedAnswer === normalizedCorrect;
    }
    return answer.trim() === question.correctAnswer.trim();
  }

  private detectErrorType(question: any, answer: string): string | null {
    if (!answer || answer.trim() === '') {
      return 'ATTENTION';
    }

    const hasNumbers = /\d/.test(answer);
    const hasOperators = /[+\-*/=]/.test(answer);

    if (question.type === 'CALCULATION') {
      if (hasNumbers && !hasOperators) {
        return 'CALCULATION';
      }
      return 'OPERATION';
    }

    if (question.type === 'MULTIPLE_CHOICE') {
      return 'CONCEPT';
    }

    return 'OTHER';
  }

  async getAttempt(attemptId: string): Promise<any> {
    return this.prisma.questionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        question: {
          include: {
            options: true,
          },
        },
        errorAnalysis: true,
      },
    });
  }

  async getAttemptsForStudent(studentId: string, limit: number = 50): Promise<any[]> {
    return this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        question: {
          include: {
            options: true,
          },
        },
        errorAnalysis: true,
      },
    });
  }
}
