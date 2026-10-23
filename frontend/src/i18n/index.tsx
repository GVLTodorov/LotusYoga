import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import bg from './bg';
import en from './en';
import type { Lang } from '../api/types';
import { ApiError } from '../api/client';

export type Key = keyof typeof bg;
const dicts: Record<Lang, Record<Key, string>> = { bg, en };
const LANG_KEY = 'sb_lang';

export function translate(lang: Lang, key: Key, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? bg[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'bg' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'bg';
}

export function errorText(lang: Lang, e: unknown): string {
  if (e instanceof ApiError) {
    const k = `err.${e.code}` as Key;
    if (k in bg) return translate(lang, k);
  }
  return translate(lang, 'err.UNKNOWN');
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  err: (e: unknown) => string;
}
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (k, p) => translate(lang, k, p), err: (e) => errorText(lang, e) }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
