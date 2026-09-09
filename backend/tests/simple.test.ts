import { describe, it, expect } from 'vitest';

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
});
