import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
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
    } catch (error) {
      clearSession();
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }

  function parseAccessToken(token: string): { userId: string; email: string; role: string } | null {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      return {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
    } catch {
      return null;
    }
  }

  async function login(email: string, password: string) {
    const response = await fetch('/api/v1/auth/login', {
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

    setState({
      user,
      loading: false,
      authenticated: true,
    });
  }

  async function signup(data: SignupData) {
    const response = await fetch('/api/v1/auth/register', {
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
        await fetch('/api/v1/auth/logout', {
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

  async function refreshSession() {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      clearSession();
      return;
    }

    try {
      const response = await fetch('/api/v1/auth/refresh', {
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
    setState({
      user: null,
      loading: false,
      authenticated: false,
    });
  }

  const value: AuthContextType = {
    ...state,
    login,
    signup,
    logout,
    refreshSession,
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
