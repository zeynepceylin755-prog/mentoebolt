/**
 * Email provider interface for password reset and verification emails.
 *
 * This abstraction allows switching between email vendors (SendGrid, Mailgun, etc.)
 * without changing application code. A mock provider is available for development.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

export interface EmailProvider {
  /**
   * Send an email. Returns true if successful, throws if not.
   */
  send(payload: EmailPayload): Promise<void>;

  /**
   * Provider name for logging/debugging.
   */
  getProviderName(): string;
}

/**
 * Mock email provider for development/testing.
 * Logs emails to console instead of sending them.
 */
export class MockEmailProvider implements EmailProvider {
  getProviderName(): string {
    return 'mock';
  }

  async send(payload: EmailPayload): Promise<void> {
    console.log('[MOCK EMAIL]', {
      to: payload.to,
      subject: payload.subject,
      preview: payload.textBody || payload.htmlBody.substring(0, 100),
    });
  }
}

/**
 * SendGrid email provider implementation.
 * Requires SENDGRID_API_KEY environment variable.
 */
export class SendGridEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  getProviderName(): string {
    return 'sendgrid';
  }

  async send(payload: EmailPayload): Promise<void> {
    // SendGrid implementation would go here
    // For now, throw to indicate this needs implementation
    throw new Error('SendGrid provider not yet implemented');
  }
}

/**
 * Email provider factory.
 * Returns the configured provider based on environment.
 */
export function createEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || 'mock';
  const fromEmail = process.env.EMAIL_FROM || 'noreply@mentora.ai';

  switch (provider) {
    case 'mock':
      return new MockEmailProvider();
    case 'sendgrid':
      const apiKey = process.env.SENDGRID_API_KEY;
      if (!apiKey) {
        console.warn('SENDGRID_API_KEY not set, falling back to mock email provider');
        return new MockEmailProvider();
      }
      return new SendGridEmailProvider(apiKey, fromEmail);
    default:
      console.warn(`Unknown email provider: ${provider}, using mock`);
      return new MockEmailProvider();
  }
}
