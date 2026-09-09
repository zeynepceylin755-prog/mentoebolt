import { z } from 'zod';
import { ValidationError } from '../../domain/errors/ValidationError.js';

export class InputSanitizer {
  static sanitizeString(input: string): string {
    // Remove potential XSS vectors
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim()
      .slice(0, 5000); // Limit length
  }

  static sanitizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  static validateAndSanitize<T>(schema: z.ZodSchema<T>, data: unknown): T {
    try {
      const validated = schema.parse(data);
      // Deep sanitize strings in the object
      return this.deepSanitize(validated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors: Record<string, string[]> = {};
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          if (!errors[path]) errors[path] = [];
          errors[path].push(err.message);
        });
        throw new ValidationError('Validation failed', errors);
      }
      throw error;
    }
  }

  private static deepSanitize<T>(obj: T): T {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepSanitize(item)) as unknown as T;
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deepSanitize(value);
      }
      return result as T;
    }
    return obj;
  }

  static validateUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
