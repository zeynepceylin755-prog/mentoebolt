import { describe, it, expect } from 'vitest';

describe('Auth API', () => {
  const baseUrl = 'http://localhost:3000/api/v1';
  
  it('should return health status', async () => {
    const response = await fetch('http://localhost:3000/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
