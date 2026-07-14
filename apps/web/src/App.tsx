import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';
import ApiKeysPage from './pages/ApiKeys';
import AuditPage from './pages/Audit';
import ConnectPage from './pages/Connect';
import LoginPage from './pages/Login';
import MemoriesPage from './pages/Memories';
import MemoryDetailPage from './pages/MemoryDetail';
import OrgDetailPage from './pages/OrgDetail';
import OrgsPage from './pages/Orgs';
import SignupPage from './pages/Signup';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SWRConfig
        value={{
          // Match the app's original behaviour: no automatic refetch on window
          // focus and no error retries. keepPreviousData keeps filtered/paginated
          // lists on screen (dimmed) while the next page loads.
          revalidateOnFocus: false,
          shouldRetryOnError: false,
          keepPreviousData: true,
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<MemoriesPage />} />
                <Route path="/memories/:id" element={<MemoryDetailPage />} />
                <Route path="/keys" element={<ApiKeysPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/orgs" element={<OrgsPage />} />
                <Route path="/orgs/:id" element={<OrgDetailPage />} />
                <Route path="/connect" element={<ConnectPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            <Toaster position="bottom-right" />
          </AuthProvider>
        </BrowserRouter>
      </SWRConfig>
    </ThemeProvider>
  );
}
