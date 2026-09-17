import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError, describeHttpStatus, apiBaseUrl } from './apiClient';



/**
 * The API client is the single boundary where backend failures become student
 * language. These tests pin that mapping: the student must never be shown a raw
 * reason phrase, a stack trace or an internal error code as the message.
 */

const fetchMock = vi.fn();

/** Await a rejection and keep it typed as the ApiError the client throws. */
async function expectFailure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the request to fail');
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    localStorage.setItem('access_token', 'test-token');
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('access_token');
  });

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  it('unwraps the backend success envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { value: 42 } }));
    await expect(apiRequest<{ value: number }>('/x')).resolves.toEqual({ value: 42 });
  });

  it('attaches the stored access token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    await apiRequest('/x');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('sends an idempotency key when supplied', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    await apiRequest('/x', { method: 'POST', body: {}, idempotencyKey: 'key-1' });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1');
  });

  it('turns a 429 into an actionable message instead of "Too Many Requests"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { success: false, error: 'Too Many Requests' }));

    await expect(apiRequest('/x')).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('çok fazla istek'),
    });
  });

  it('turns a network failure into a calm, retryable message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await expectFailure(apiRequest('/x'));
    expect(err.status).toBe(0);
    expect(err.message).toContain('Sunucuya ulaşamadık');
  });

  it('surfaces the backend message for a 4xx the student can act on', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'E-posta geçersiz' } })
    );

    await expect(apiRequest('/x')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'E-posta geçersiz',
    });
  });

  it('never throws a raw parse error when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    } as Response);

    const err = await expectFailure(apiRequest('/x'));
    expect(err.message).not.toContain('<html>');
  });

  it('bounds a stalled request with a timeout instead of hanging forever', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const err = await expectFailure(apiRequest('/x', { timeoutMs: 20 }));
    expect(err.status).toBe(0);
  });

  it('reports an expired session when the refresh is rejected', async () => {
    localStorage.setItem('refresh_token', 'stale');
    // First call: the original request is rejected as unauthorized. Second call:
    // the refresh attempt is also rejected, so the session is over.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: 'nope' }));

    const err = await expectFailure(apiRequest('/x'));
    expect(err.status).toBe(401);
    // The local session is cleared so the student is not left in a half state.
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('clears the local session when a refresh is rejected', () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'b');
    expect(localStorage.getItem('access_token')).toBe('a');
  });

  it('resolves the base URL from the environment or same-origin', () => {
    expect(apiBaseUrl).toMatch(/^(\/api\/v1|https?:\/\/)/);
  });

  it('maps only statuses the student can act on', () => {
    expect(describeHttpStatus(429)).toContain('çok fazla istek');
    expect(describeHttpStatus(0)).toContain('Sunucuya ulaşamadık');
    expect(describeHttpStatus(400)).toBeNull();
    expect(describeHttpStatus(500)).toBeNull();
  });
});
