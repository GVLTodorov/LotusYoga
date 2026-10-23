import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import type { Lang, Role, User } from '../api/types';
import { useI18n } from '../i18n';

interface Auth {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (b: { email: string; password: string; name: string; phone: string }) => Promise<User>;
  logout: () => void;
  updateProfile: (b: { name?: string; phone?: string }) => Promise<void>;
  changeLang: (l: Lang) => void;
}
const Ctx = createContext<Auth | null>(null);

export function homePath(role: Role | undefined): string {
  if (role === 'INSTRUCTOR') return '/today';
  if (role === 'ADMIN') return '/admin/schedule';
  return '/';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !!getToken());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    api
      .me()
      .then((u) => {
        if (!alive) return;
        setUser(u);
      })
      .catch(() => {
        /* invalid token: handler logs out on 401; network errors keep token */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<Auth>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const r = await api.login({ email, password });
        setToken(r.token);
        setUser(r.user);
        setLang(r.user.lang);
        return r.user;
      },
      register: async (b) => {
        const r = await api.register({ ...b, lang });
        setToken(r.token);
        setUser(r.user);
        return r.user;
      },
      logout,
      updateProfile: async (b) => {
        setUser(await api.updateMe(b));
      },
      changeLang: (l) => {
        setLang(l);
        if (user) {
          api
            .updateMe({ lang: l })
            .then(setUser)
            .catch(() => {
              /* language still changed locally */
            });
        }
      },
    }),
    [user, loading, lang, logout, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
