import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface CreateAssessmentDTO {
  title: string;
  description?: string;
  type: 'DIAGNOSTIC' | 'FORMATIVE' | 'SUMMATIVE' | 'PRACTICE';
  skillIds: string[];
  topicIds?: string[];
  timeLimitMinutes?: number;
  passingScore?: number;
  metadata?: Record<string, unknown>;
}

export class AssessmentService {
  constructor(private readonly prisma: PrismaClient) {}

  async createAssessment(dto: CreateAssessmentDTO): Promise<any> {
    const assessment = await this.prisma.assessment.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        status: 'DRAFT',
        skillIds: JSON.stringify(dto.skillIds),
        topicIds: dto.topicIds ? JSON.stringify(dto.topicIds) : null,
        totalQuestions: 0,
        timeLimitMinutes: dto.timeLimitMinutes,
        passingScore: dto.passingScore,
        isActive: true,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      },
    });

    logger.info({ assessmentId: assessment.id, type: assessment.type }, 'Assessment created');
    return assessment;
  }

  async addQuestionsToAssessment(assessmentId: string, questionIds: string[]): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.status === 'PUBLISHED') {
      throw new Error('Cannot add questions to published assessment');
    }

    const results = [];
    for (let i = 0; i < questionIds.length; i++) {
      const result = await this.prisma.assessmentQuestion.create({
        data: {
          assessmentId,
          questionId: questionIds[i],
          order: i + 1,
          points: 1,
        },
      });
      results.push(result);
    }

    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        totalQuestions: { increment: questionIds.length },
      },
    });

    logger.info({ assessmentId, questionCount: questionIds.length }, 'Questions added to assessment');
    return results;
  }

  async publishAssessment(assessmentId: string): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.questions.length === 0) {
      throw new Error('Cannot publish assessment with no questions');
    }

    return this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { status: 'PUBLISHED' },
    });
  }

  async startAssessment(studentId: string, assessmentId: string): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.status !== 'PUBLISHED') {
      throw new Error('Assessment is not published');
    }

    const existing = await this.prisma.assessmentAttempt.findUnique({
      where: {
        studentId_assessmentId: {
          studentId,
          assessmentId,
        },
      },
    });

    if (existing && existing.status === 'IN_PROGRESS') {
      return existing;
    }

    if (existing && existing.status === 'COMPLETED') {
      throw new Error('Assessment already completed');
    }

    const attempt = await this.prisma.assessmentAttempt.create({
      data: {
        studentId,
        assessmentId,
        startedAt: new Date(),
        status: 'IN_PROGRESS',
      },
    });

    logger.info({ attemptId: attempt.id, assessmentId }, 'Assessment started');
    return attempt;
  }

  async submitAnswer(
    attemptId: string,
    questionId: string,
    answer: string,
    timeSpentSeconds: number,
    confidence?: number
  ): Promise<any> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: true,
        questionAttempts: true,
      },
    });

    if (!attempt) {
      throw new Error('Assessment attempt not found');
    }

    if (attempt.status !== 'IN_PROGRESS') {
      throw new Error('Assessment is not in progress');
    }

    const assessmentQuestion = await this.prisma.assessmentQuestion.findUnique({
      where: {
        assessmentId_questionId: {
          assessmentId: attempt.assessmentId,
          questionId,
        },
      },
      include: { question: true },
    });

    if (!assessmentQuestion) {
      throw new Error('Question is not part of this assessment');
    }

    const existing = attempt.questionAttempts.find(q => q.questionId === questionId);
    if (existing) {
      throw new Error('Question already answered');
    }

    const isCorrect = assessmentQuestion.question.correctAnswer === answer;

    const questionAttempt = await this.prisma.questionAttempt.create({
      data: {
        studentId: attempt.studentId,
        questionId,
        assessmentAttemptId: attemptId,
        answer,
        isCorrect,
        timeSpentSeconds,
        confidence,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    const answers = attempt.answers ? JSON.parse(attempt.answers) : [];
    answers.push({
      questionId,
      answer,
      isCorrect,
      timeSpentSeconds,
    });

    await this.prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        answers: JSON.stringify(answers),
      },
    });

    return {
      attemptId,
      questionId,
      isCorrect,
      correctAnswer: assessmentQuestion.question.correctAnswer,
    };
  }

  async completeAssessment(attemptId: string): Promise<any> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: {
          include: {
            questions: {
              include: {
                question: true,
              },
            },
          },
        },
        questionAttempts: {
          include: {
            question: true,
          },
        },
      },
    });

    if (!attempt) {
      throw new Error('Assessment attempt not found');
    }

    if (attempt.status === 'COMPLETED') {
      throw new Error('Assessment already completed');
    }

    if (attempt.status !== 'IN_PROGRESS') {
      throw new Error('Assessment is not in progress');
    }

    let totalScore = 0;
    let maxScore = 0;

    for (const q of attempt.questionAttempts) {
      const points = attempt.assessment.questions.find(aq => aq.questionId === q.questionId)?.points || 1;
      maxScore += points;
      if (q.isCorrect) {
        totalScore += points;
      }
    }

    const percentageScore = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const timeSpentSeconds = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);

    const completed = await this.prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        score: totalScore,
        maxScore,
        percentageScore,
        timeSpentSeconds,
      },
    });

    logger.info({
      attemptId,
      score: totalScore,
      percentageScore,
    }, 'Assessment completed');

    return completed;
  }

  async getAssessmentResults(attemptId: string): Promise<any> {
    return this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: true,
        questionAttempts: {
          include: {
            question: true,
          },
        },
      },
    });
  }
}
