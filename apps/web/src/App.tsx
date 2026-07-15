import { Component, lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { errorMessage } from './api';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { PageLoading } from './components/PageLoading';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';

const ApiKeysPage = lazy(() => import('./pages/ApiKeys'));
const AuditPage = lazy(() => import('./pages/Audit'));
const ConnectPage = lazy(() => import('./pages/Connect'));
const HomePage = lazy(() => import('./pages/Home'));
const LoginPage = lazy(() => import('./pages/Login'));
const MemoriesPage = lazy(() => import('./pages/Memories'));
const MemoryDetailPage = lazy(() => import('./pages/MemoryDetail'));
const MemoryDetailModal = lazy(() => import('./components/MemoryDetailModal'));
const OrgDetailPage = lazy(() => import('./pages/OrgDetail'));
const OrgsPage = lazy(() => import('./pages/Orgs'));
const SignupPage = lazy(() => import('./pages/Signup'));

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

function AuthErrorScreen({ error, retry }: { error: unknown; retry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retry();
    } catch {
      // The auth provider retains the latest error for this screen.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-sm rounded-xl border bg-card p-5 text-center">
        <h1 className="font-heading text-lg font-semibold">Echo is unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button className="mt-4" onClick={() => void onRetry()} disabled={retrying}>
          {retrying && <Spinner />}
          Retry
        </Button>
      </div>
    </main>
  );
}

class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown; hasError: boolean }
> {
  state = { error: null as unknown, hasError: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex min-h-64 items-center justify-center px-5">
        <div className="max-w-sm rounded-xl border bg-card p-5 text-center">
          <h1 className="font-heading text-lg font-semibold">This page could not be loaded</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The dashboard may have been updated since this tab was opened. Reload to get the current page files.
          </p>
          <p className="mt-2 break-words text-xs text-muted-foreground">{errorMessage(this.state.error)}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Reload Echo
          </Button>
        </div>
      </div>
    );
  }
}

function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <PageErrorBoundary key={pathname}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();
  // Memory cards navigate to /memories/:id carrying the list as `background`, so
  // the detail renders as a modal over that page. Without a background (a direct
  // visit or refresh), the /memories/:id route below renders the full page.
  const background = (location.state as { background?: Location } | null)?.background;

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/login" element={<Page><LoginPage /></Page>} />
        <Route path="/signup" element={<Page><SignupPage /></Page>} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Page><HomePage /></Page>} />
          <Route path="/memories" element={<Page><MemoriesPage /></Page>} />
          <Route path="/memories/:id" element={<Page><MemoryDetailPage /></Page>} />
          <Route path="/keys" element={<Page><ApiKeysPage /></Page>} />
          <Route path="/audit" element={<Page><AuditPage /></Page>} />
          <Route path="/orgs" element={<Page><OrgsPage /></Page>} />
          <Route path="/orgs/:id" element={<Page><OrgDetailPage /></Page>} />
          <Route path="/connect" element={<Page><ConnectPage /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      {background && (
        <Routes>
          <Route path="/memories/:id" element={<Page><MemoryDetailModal /></Page>} />
        </Routes>
      )}
    </>
  );
}

function AuthGate() {
  const { error, loading, refresh } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (error) return <AuthErrorScreen error={error} retry={refresh} />;
  return <AppRoutes />;
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SWRConfig
        value={{
          // Echo is commonly mutated by other connected apps. Refresh when the
          // dashboard becomes active again, while deduping quick tab switches.
          revalidateOnFocus: true,
          revalidateOnReconnect: true,
          dedupingInterval: 5_000,
          shouldRetryOnError: false,
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <AuthGate />
            <Toaster position="bottom-right" />
          </AuthProvider>
        </BrowserRouter>
      </SWRConfig>
    </ThemeProvider>
  );
}
