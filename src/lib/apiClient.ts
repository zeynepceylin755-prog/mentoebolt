/**
 * Canonical API client for the Mentora backend.
 *
 * The backend URL is environment-based (VITE_API_BASE_URL). It is never
 * hardcoded; when unset, a same-origin `/api/v1` path is used so the app can be
 * served behind a reverse proxy without a rebuild.
 *
 * This client integrates with AuthContext for automatic token management:
 * - Automatically attaches access tokens from localStorage
 * - Handles 401 errors with automatic token refresh
 * - Retries the original request after successful refresh
 * - Prevents infinite refresh loops
 */

const RAW_BASE = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined;

const BASE_URL = (RAW_BASE && RAW_BASE.trim().length > 0)
  ? RAW_BASE.replace(/\/$/, '')
  : '/api/v1';

/** Backend error shape: { success: false, error: { code, message } (see ErrorHandler). */
export interface ApiErrorBody {
  success?: boolean;
  error?: { code?: string; message?: string } | string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  idempotencyKey?: string;
  skipAuth?: boolean;
}

function extractErrorMessage(payload: ApiErrorBody | null, status: number): { message: string; code?: string } {
  if (!payload) {
    return { message: `İstek başarısız oldu (HTTP ${status}).` };
  }
  const err = payload.error;
  if (typeof err === 'string') {
    return { message: err };
  }
  if (err && typeof err === 'object') {
    return { message: err.message || `İstek başarısız oldu (HTTP ${status}).`, code: err.code };
  }
  return { message: `İstek başarısız oldu (HTTP ${status}).` };
}

function getAccessToken(): string | null {
  return localStorage.getItem('access_token');
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      return null;
    }

    const data = await response.json();
    const { accessToken, refreshToken: newRefreshToken } = data.data;

    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', newRefreshToken);

    return accessToken;
  } catch {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    return null;
  }
}

let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

function subscribeToRefresh(callback: (token: string | null) => void) {
  refreshSubscribers.push(callback);
}

function onRefreshComplete(token: string | null) {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
}

/**
 * Perform an API request. Returns the parsed `data` field on success and throws
 * `ApiError` on any non-2xx response (including 401/400/409). Network failures
 * are surfaced as `ApiError` with status 0 so the UI can handle them uniformly.
 *
 * Auth integration:
 * - Automatically uses access token from localStorage unless skipAuth is true
 * - Handles 401 with automatic token refresh and retry
 * - Prevents infinite refresh loops
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const token = options.token ?? (options.skipAuth ? null : getAccessToken());
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkError) {
    throw new ApiError(
      'Sunucuya ulaşılamadı. Lütfen bağlantını kontrol et.',
      0,
      'NETWORK_ERROR'
    );
  }

  let json: any = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (response.status === 401 && !options.skipAuth && token) {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken) => {
          if (newToken) {
            apiRequest<T>(path, { ...options, token: newToken })
              .then(resolve)
              .catch(reject);
          } else {
            reject(new ApiError('Oturum süresi doldu. Lütfen tekrar giriş yap.', 401, 'SESSION_EXPIRED'));
          }
        });
      });
    }

    isRefreshing = true;
    const newToken = await refreshAccessToken();
    isRefreshing = false;

    if (newToken) {
      onRefreshComplete(newToken);
      return apiRequest<T>(path, { ...options, token: newToken });
    } else {
      onRefreshComplete(null);
      throw new ApiError('Oturum süresi doldu. Lütfen tekrar giriş yap.', 401, 'SESSION_EXPIRED');
    }
  }

  if (!response.ok) {
    const { message, code } = extractErrorMessage(json, response.status);
    throw new ApiError(message, response.status, code);
  }

  // Backend wraps successful payloads as { success: true, data }.
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;
}

export const apiBaseUrl = BASE_URL;
