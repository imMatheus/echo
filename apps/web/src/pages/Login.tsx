import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { LogoMark } from '../components/icons'
import { LoginForm } from '../components/login-form'

/** Shared two-column auth shell (shadcn login-02 block layout). */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <LogoMark size={24} />
            Echo
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          // src="https://cdn.midjourney.com/56be6a5a-97a1-4d08-af25-347a8bd4e7f6/0_1.png"
          src="https://cdn.midjourney.com/f030bf52-824b-4326-9b00-3cd8a057a467/0_1.png"
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { user, loading } = useAuth()

  if (!loading && user) return <Navigate to="/" replace />

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  )
}
