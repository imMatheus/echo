import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { useMeta } from '@/hooks';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export function LoginForm({ className, ...props }: React.ComponentProps<'form'>) {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.login({ email: email.trim(), password });
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof api.ApiRequestError && err.code === 'email_not_verified') {
        navigate(`/check-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(errorMessage(err));
      setPending(false);
    }
  };

  const showSignupLink = !meta || meta.signupEnabled;

  return (
    <form className={cn('flex flex-col gap-6', className)} onSubmit={(e) => void submit(e)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-heading text-2xl font-bold">Login to your account</h1>
          <p className="text-sm text-balance text-muted-foreground">Enter your email below to login to your account</p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            placeholder="m@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
            maxLength={254}
          />
        </Field>
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="login-password">Password</FieldLabel>
            <Link to="/forgot-password" className="text-xs underline underline-offset-4">
              Forgot password?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Login
          </Button>
        </Field>
        {showSignupLink && (
          <FieldDescription className="text-center">
            Don&apos;t have an account?{' '}
            <Link to="/signup" className="underline underline-offset-4">
              Sign up
            </Link>
          </FieldDescription>
        )}
        {meta && (
          <FieldDescription className="text-center text-muted-foreground/70">
            {meta.name} v{meta.version}
          </FieldDescription>
        )}
      </FieldGroup>
    </form>
  );
}
