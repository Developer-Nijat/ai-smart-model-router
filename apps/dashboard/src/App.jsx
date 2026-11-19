import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi, codeFromHash } from './api.js';
import { Button, Notice } from './components/ui.jsx';
import { Overview } from './pages/Overview.jsx';
import { History } from './pages/History.jsx';
import { Rules } from './pages/Rules.jsx';
import { Models, Agents } from './pages/Catalog.jsx';
import { Settings } from './pages/Settings.jsx';

export const PAGES = [
  { path: '/', title: 'Overview', Component: Overview },
  { path: '/history', title: 'Routing history', Component: History },
  { path: '/rules', title: 'Routing rules', Component: Rules },
  { path: '/agents', title: 'Agents', Component: Agents },
  { path: '/models', title: 'Models', Component: Models },
  { path: '/settings', title: 'Settings', Component: Settings },
];

const THEME_KEY = 'smr-theme';

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A preference only: fine to lose.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next) => {
    window.history.pushState(null, '', next);
    setPath(next);
  }, []);
  return [path, go];
}

export function App({ api: injected }) {
  const api = useMemo(() => injected ?? createApi(), [injected]);
  const [signedIn, setSignedIn] = useState(api.signedIn);
  const [signInError, setSignInError] = useState(null);
  const [signingIn, setSigningIn] = useState(() => codeFromHash(window.location.hash) !== null);
  const [path, go] = usePath();
  const [theme, toggleTheme] = useTheme();

  // A `#code=` link from `mr dashboard`: trade it for a session, then drop it from the URL
  // and history so it is never reused or shown.
  useEffect(() => {
    const code = codeFromHash(window.location.hash);
    if (!code) return;
    window.history.replaceState(null, '', window.location.pathname);
    api.signIn(code).then(
      () => {
        setSignedIn(true);
        setSignInError(null);
        setSigningIn(false);
      },
      (error) => {
        setSignInError(error.message);
        setSigningIn(false);
      },
    );
  }, [api]);

  const onSignedOut = useCallback((reason) => {
    setSignInError(reason === 'signed out' ? null : `${reason}: run mr dashboard to sign in again.`);
    setSignedIn(false);
  }, []);

  const page = PAGES.find((p) => p.path === path) ?? PAGES[0];
  useEffect(() => {
    document.title = `${page.title} · Smart Model Router`;
  }, [page]);

  if (!signedIn) return <SignIn busy={signingIn} error={signInError} theme={theme} onTheme={toggleTheme} />;

  const { Component } = page;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav aria-label="Main" className="flex shrink-0 flex-col border-b border-line bg-surface md:w-52 md:border-r md:border-b-0">
        <div className="px-4 py-3">
          <div className="text-[13px] font-semibold text-ink">Smart Model Router</div>
          <div className="text-xs text-faint">local dashboard</div>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {PAGES.map((p) => (
            <li key={p.path}>
              <a
                href={p.path}
                aria-current={p.path === page.path ? 'page' : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  go(p.path);
                }}
                className={`block whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] ${p.path === page.path ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
              >
                {p.title}
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-auto hidden flex-col gap-1 p-2 md:flex">
          <Button variant="ghost" onClick={toggleTheme} className="justify-start">
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </Button>
          <Button variant="ghost" onClick={() => api.signOut().finally(() => onSignedOut('signed out'))} className="justify-start">
            Sign out
          </Button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8">
        <div className="mx-auto max-w-6xl">
          {signInError && (
            <div className="mb-4">
              <Notice tone="critical">{signInError}</Notice>
            </div>
          )}
          <Component api={api} onSignedOut={onSignedOut} />
        </div>
      </main>
    </div>
  );
}

function SignIn({ busy, error, theme, onTheme }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h1 className="text-base font-semibold text-ink">Smart Model Router</h1>
        {busy ? (
          <p className="mt-3 text-[13px] text-muted">Signing in…</p>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-muted">This dashboard opens from your terminal, so only you can sign in. Run:</p>
            <pre className="mt-3 rounded-md bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink">mr dashboard</pre>
            <p className="mt-3 text-xs text-faint">It opens this page with a one-time link that works for a minute.</p>
          </>
        )}
        {error && (
          <div className="mt-4">
            <Notice tone="critical">{error}</Notice>
          </div>
        )}
        <div className="mt-4">
          <Button variant="ghost" onClick={onTheme} className="px-0">
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </Button>
        </div>
      </div>
    </main>
  );
}
