import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Simple Test', () => {
  beforeEach(() => {
    vi.resetModules();
  });

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

  it('should not start a server when imported as a module', async () => {
    const http = await import('node:http');
    const listenSpy = vi.spyOn(http.Server.prototype, 'listen');
    const previousArgv1 = process.argv[1];
    process.argv[1] = '/tmp/not-the-server-entry.js';

    try {
      await import('../src/index.js');
      expect(listenSpy).not.toHaveBeenCalled();
    } finally {
      process.argv[1] = previousArgv1;
      listenSpy.mockRestore();
    }
  });
});
