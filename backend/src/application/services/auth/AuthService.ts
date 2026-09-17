import { User } from '../../../domain/entities/User.js';
import { Student } from '../../../domain/entities/Student.js';
import { RefreshToken } from '../../../domain/entities/RefreshToken.js';
import { Session } from '../../../domain/entities/Session.js';
import { AuthenticationError, AccountLockedError } from '../../../domain/errors/AuthenticationError.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';
import { IUserRepository } from '../../../domain/interfaces/IUserRepository.js';
import { IStudentRepository } from '../../../domain/interfaces/IStudentRepository.js';
import { IRefreshTokenRepository } from '../../../domain/interfaces/IRefreshTokenRepository.js';
import { ISessionRepository } from '../../../domain/interfaces/ISessionRepository.js';
import { TokenService, TokenPair } from '../../../domain/services/TokenService.js';
import { PasswordService } from '../../../domain/services/PasswordService.js';
import { logger } from '../../../infrastructure/logging/logger.js';
import { randomUUID } from 'crypto';

export interface RegisterDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  grade: number;
  school?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    emailVerified: boolean;
    studentProfile?: {
      id: string;
      grade: number;
      school?: string;
      learningStage?: string;
    };
  };
  tokens: TokenPair;
}

export class AuthService {
  private readonly maxLoginAttempts = 5;
  private readonly lockDurationMinutes = 15;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly studentRepository: IStudentRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly sessionRepository: ISessionRepository,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService
  ) {}

  async register(dto: RegisterDTO): Promise<AuthResponse> {
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ValidationError('User with this email already exists');
    }

    const passwordValidation = this.passwordService.validatePasswordStrength(dto.password);
    if (!passwordValidation.valid) {
      throw new ValidationError('Password does not meet requirements', {
        password: passwordValidation.errors,
      });
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = User.create({
      email: dto.email,
      passwordHash,
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

    // Phase 6.7 (privacy): log the internal userId only — the email is PII and
    // has no diagnostic value that the userId does not already provide.
    logger.info({ userId: savedUser.id }, 'User registered');

    const tokens = await this.generateTokens(savedUser);

    return this.buildAuthResponse(savedUser, savedStudent, tokens);
  }

  async login(dto: LoginDTO): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (1000 * 60));
      throw new AccountLockedError(`Account is locked for ${remainingMinutes} minutes`);
    }

    if (!user.passwordHash) {
      throw new AuthenticationError('Invalid email or password');
    }

    const isValid = await this.passwordService.verify(dto.password, user.passwordHash);
    if (!isValid) {
      await this.handleFailedLogin(user);
      throw new AuthenticationError('Invalid email or password');
    }

    await this.resetLoginAttempts(user);
    await this.updateLastLogin(user);

    const student = await this.studentRepository.findByUserId(user.id);

    const sessionToken = this.tokenService.generateSecureToken();
    const session = Session.create({
      userId: user.id,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
    });
    await this.sessionRepository.save(session);

    // Phase 6.7 (privacy): userId + sessionId only; never the email (PII).
    logger.info({ userId: user.id, sessionId: session.id }, 'User logged in');

    const tokens = await this.generateTokens(user);

    return this.buildAuthResponse(user, student, tokens);
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.tokenService.verifyRefreshToken(refreshToken);

      const storedToken = await this.refreshTokenRepository.findByToken(refreshToken);
      if (!storedToken) {
        throw new AuthenticationError('Invalid refresh token');
      }

      if (!storedToken.isActive()) {
        if (storedToken.isExpired()) {
          throw new AuthenticationError('Refresh token has expired');
        }
        if (storedToken.isRevoked()) {
          throw new AuthenticationError('Refresh token has been revoked');
        }
        throw new AuthenticationError('Invalid refresh token');
      }

      const user = await this.userRepository.findById(payload.userId);
      if (!user) {
        throw new AuthenticationError('User not found');
      }

      // Check if user is soft-deleted (if the field exists in the user object)
      if ('deletedAt' in user && user.deletedAt) {
        throw new AuthenticationError('User account has been deleted');
      }

      // Check if user is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AuthenticationError('Account is temporarily locked');
      }

      // Revoke old token and generate new ones (token rotation)
      await this.refreshTokenRepository.revoke(storedToken.id);
      const tokens = await this.generateTokens(user);

      logger.info({ userId: user.id }, 'Token refreshed successfully');
      return tokens;
    } catch (error) {
      logger.warn({ error }, 'Refresh token verification failed');
      throw new AuthenticationError('Invalid or expired refresh token');
    }
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    // Revoke all refresh tokens for the user
    await this.refreshTokenRepository.revokeAllForUser(userId);

    // Delete all sessions for the user
    await this.sessionRepository.deleteAllForUser(userId);

    logger.info({ userId, hasRefreshToken: !!refreshToken }, 'User logged out');
  }

  private async generateTokens(user: User): Promise<TokenPair> {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.tokenService.generateAccessToken(payload);

    const refreshTokenId = randomUUID();
    const refreshTokenString = this.tokenService.generateRefreshToken(user.id, refreshTokenId);

    const refreshToken = RefreshToken.create({
      userId: user.id,
      token: refreshTokenString,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await this.refreshTokenRepository.save(refreshToken);

    return { accessToken, refreshToken: refreshTokenString };
  }

  private async handleFailedLogin(user: User): Promise<void> {
    const attempts = (user.loginAttempts || 0) + 1;
    let lockedUntil: Date | undefined;

    if (attempts >= this.maxLoginAttempts) {
      lockedUntil = new Date(Date.now() + this.lockDurationMinutes * 60 * 1000);
      // Phase 6.7 (privacy): userId only; the email is PII.
      logger.warn({ userId: user.id }, 'Account locked due to too many failed login attempts');
    }

    await this.userRepository.update(user.id, {
      loginAttempts: attempts,
      lockedUntil,
    });
  }

  private async resetLoginAttempts(user: User): Promise<void> {
    await this.userRepository.update(user.id, {
      loginAttempts: 0,
      lockedUntil: null,
    });
  }

  private async updateLastLogin(user: User): Promise<void> {
    await this.userRepository.update(user.id, {
      lastLoginAt: new Date(),
    });
  }

  private buildAuthResponse(user: User, student: Student | null, tokens: TokenPair): AuthResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
        studentProfile: student ? {
          id: student.id,
          grade: student.grade,
          school: student.school,
          learningStage: student.learningStage || 'DISCOVERY',
        } : undefined,
      },
      tokens,
    };
  }
}
