import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken } from '../api/client';
import type { Membership, User } from '../api/types';

type AuthState = {
  user: User | null;
  memberships: Membership[];
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [ready, setReady] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setMemberships([]);
      return;
    }
    const me = await api<User & { memberships: Membership[] }>('/api/v1/me');
    setUser(me);
    setMemberships(me.memberships ?? []);
  }, []);

  useEffect(() => {
    refreshMe()
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{
      token: string;
      user: User;
      memberships: Membership[];
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setUser(data.user);
    setMemberships(data.memberships);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setMemberships([]);
  }, []);

  const value = useMemo(
    () => ({ user, memberships, ready, login, logout, refreshMe }),
    [user, memberships, ready, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
