import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { useMeta } from '@/hooks';
import { AuthLayout } from './Login';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export default function SignupPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  const signupDisabled = meta != null && !meta.signupEnabled;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setPending(true);
    try {
      const result = await api.signup({ name: name.trim(), email: email.trim(), password });
      navigate(`/check-email?email=${encodeURIComponent(result.email)}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      {signupDisabled ? (
        <Alert>
          <AlertTitle>Sign-ups are disabled on this server.</AlertTitle>
        </Alert>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-1 text-center">
              <h1 className="font-heading text-2xl font-bold">Create your account</h1>
              <p className="text-sm text-balance text-muted-foreground">
                Enter your details below to get started
              </p>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="signup-name">Name</FieldLabel>
              <Input
                id="signup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                autoFocus
                maxLength={100}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-email">Email</FieldLabel>
              <Input
                id="signup-email"
                type="email"
                placeholder="m@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-password">Password</FieldLabel>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Field>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Create account
              </Button>
            </Field>
            <FieldDescription className="text-center">
              Already have an account?{' '}
              <Link to="/login" className="underline underline-offset-4">
                Log in
              </Link>
            </FieldDescription>
          </FieldGroup>
        </form>
      )}
    </AuthLayout>
  );
}
