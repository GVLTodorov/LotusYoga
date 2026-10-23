import {
  useCallback, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
} from 'react';
import { useI18n } from '../i18n';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-400',
  secondary: 'bg-white text-brand-800 border-2 border-brand-700 hover:bg-brand-50 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400',
  ghost: 'bg-transparent text-brand-800 hover:bg-brand-50 disabled:opacity-50',
};

export function Button({
  variant = 'primary', className = '', ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl px-4 py-2 text-base font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  );
}

export function Field({
  label, hint, error, ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-d` : undefined}
        {...p}
        className="min-h-12 w-full min-w-0 rounded-xl border-2 border-slate-400 bg-white px-3 py-2 text-base focus:border-brand-700"
      />
      {(hint || error) && (
        <span id={`${id}-d`} className={`text-sm ${error ? 'text-red-700' : 'text-slate-600'}`}>{error ?? hint}</span>
      )}
    </div>
  );
}

export function Select({
  label, children, ...p
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      <select
        id={id}
        {...p}
        className="min-h-12 w-full min-w-0 rounded-xl border-2 border-slate-400 bg-white px-3 py-2 text-base focus:border-brand-700"
      >
        {children}
      </select>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'green' | 'red' | 'amber' | 'blue' }) {
  const tones = {
    gray: 'bg-slate-200 text-slate-800',
    green: 'bg-green-100 text-green-900',
    red: 'bg-red-100 text-red-900',
    amber: 'bg-amber-100 text-amber-900',
    blue: 'bg-sky-100 text-sky-900',
  };
  return <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Spinner() {
  const { t } = useI18n();
  return (
    <p role="status" className="p-6 text-center text-slate-600">{t('common.loading')}</p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
      <p>{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

export function Notice({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' }) {
  const c = tone === 'green' ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-400 bg-amber-50 text-amber-900';
  return <p role="status" className={`rounded-xl border-2 p-3 ${c}`}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-400 p-6 text-center text-slate-600">{children}</p>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 text-2xl font-bold sm:text-3xl">{children}</h1>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl p-0 shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-xl font-bold">{title}</h2>
          <Button variant="ghost" aria-label={t('common.close')} onClick={onClose}>✕</Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Load data with loading/error/reload handling. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef.current()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/** Standard wrapper rendering loading / error states, then children(data). */
export function Async<T>({
  state, children,
}: {
  state: { data: T | null; error: unknown; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
}) {
  const { err } = useI18n();
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorBox message={err(state.error)} onRetry={state.reload} />;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}
