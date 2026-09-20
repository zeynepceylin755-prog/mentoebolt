import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiBaseUrl } from '@/lib/apiClient';
import { clearCache } from '@/lib/requestCache';

interface StudentProfile {
  id: string;
  grade: number;
  school?: string;
  learningStage?: string;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerified: boolean;
  studentProfile?: StudentProfile;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  authenticated: boolean;
}

interface AuthContextType extends AuthState {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
}

interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  grade: number;
  school?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    authenticated: false,
  });

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const accessToken = localStorage.getItem('access_token');
      const refreshToken = localStorage.getItem('refresh_token');

      if (accessToken && refreshToken) {
        const parsed = parseAccessToken(accessToken);
        if (parsed) {
          setState({
            user: {
              id: parsed.userId,
              email: parsed.email,
              firstName: '',
              lastName: '',
              role: parsed.role,
              emailVerified: false,
            },
            loading: false,
            authenticated: true,
          });
          return;
        }

        await refreshSession();
        return;
      }
    } catch {
      clearSession();
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }

  /**
   * Read the non-sensitive identity claims out of an access token.
   *
   * Only display claims are read here — never a secret, and never a claim used
   * for an authorization decision (the backend re-derives identity on every
   * request, so a tampered local token grants nothing).
   */
  function parseAccessToken(token: string): { userId: string; email: string; role: string } | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) {
        return null;
      }
      const decoded = JSON.parse(atob(payload));
      if (typeof decoded?.userId !== 'string') {
        return null;
      }
      return {
        userId: decoded.userId,
        email: typeof decoded.email === 'string' ? decoded.email : '',
        role: typeof decoded.role === 'string' ? decoded.role : 'STUDENT',
      };
    } catch {
      return null;
    }
  }

  async function login(email: string, password: string) {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Giriş başarısız');
    }

    const data = await response.json();
    const { user, tokens } = data.data;

    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);
    // A fresh sign-in starts from an empty cache: on a shared device the previous
    // student's evidence must never be rendered under the new identity.
    clearCache();

    setState({
      user,
      loading: false,
      authenticated: true,
    });
  }

  async function signup(data: SignupData) {
    const response = await fetch(`${apiBaseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Kayıt başarısız');
    }

    const result = await response.json();
    const { user, tokens } = result.data;

    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);
    clearCache();

    setState({
      user,
      loading: false,
      authenticated: true,
    });
  }

  async function logout() {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        await fetch(`${apiBaseUrl}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch {
    } finally {
      clearSession();
    }
  }

  async function forgotPassword(email: string) {
    const response = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'İstek başarısız');
    }
  }

  async function resetPassword(token: string, newPassword: string) {
    const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Şifre sıfırlama başarısız');
    }
  }

  async function refreshSession() {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      clearSession();
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearSession();
        return;
      }

      const data = await response.json();
      const { accessToken, refreshToken: newRefreshToken } = data.data;

      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', newRefreshToken);

      const parsed = parseAccessToken(accessToken);
      if (parsed) {
        setState({
          user: {
            id: parsed.userId,
            email: parsed.email,
            firstName: '',
            lastName: '',
            role: parsed.role,
            emailVerified: false,
          },
          loading: false,
          authenticated: true,
        });
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  }

  function clearSession() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    // Never let one student's learning data survive into another student's
    // session on a shared device.
    clearCache();
    setState({
      user: null,
      loading: false,
      authenticated: false,
    });
  }

  const value: AuthContextType = {
    ...state,
    token: localStorage.getItem('access_token'),
    login,
    signup,
    logout,
    refreshSession,
    forgotPassword,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}