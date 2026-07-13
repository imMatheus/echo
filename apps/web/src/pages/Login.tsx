import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { LogoMark } from '../components/icons';
import { LoginForm } from '../components/login-form';

/** Shared two-column auth shell (shadcn login-02 block layout). */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <LogoMark size={24} />
            Echo
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6">
            <LogoMark size={160} />
            <p className="max-w-2xs text-center text-sm text-balance text-muted-foreground">
              The open context layer for AI apps — one memory, every tool.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { user, loading } = useAuth();

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
