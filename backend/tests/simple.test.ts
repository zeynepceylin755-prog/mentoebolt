import { describe, it, expect } from 'vitest';
import { shouldAutoStartServer } from '../src/index.js';

describe('Simple Test', () => {
  it('should pass basic test', () => {
    expect(true).toBe(true);
  });

  it('should do math correctly', () => {
    expect(1 + 1).toBe(2);
    expect(2 * 3).toBe(6);
  });

  it('should handle strings', () => {
    const greeting = 'Hello, World!';
    expect(greeting).toContain('Hello');
    expect(greeting.length).toBeGreaterThan(0);
  });

  it('should not auto-start in production when imported as a module', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousArgv1 = process.argv[1];

    process.env.NODE_ENV = 'production';
    process.argv[1] = '/tmp/not-the-server-entry.js';

    try {
      expect(shouldAutoStartServer()).toBe(false);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.argv[1] = previousArgv1;
    }
  });
});
