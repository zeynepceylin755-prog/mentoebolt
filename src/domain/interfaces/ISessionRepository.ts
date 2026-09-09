import { Session } from '../entities/Session.js';

export interface ISessionRepository {
  save(session: Session): Promise<Session>;
  findByToken(token: string): Promise<Session | null>;
  findByUserId(userId: string): Promise<Session[]>;
  delete(sessionId: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  deleteExpired(): Promise<void>;
}
