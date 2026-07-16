import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './Login';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const token = params.get('token') ?? '';
    if (!token) {
      setError('This password reset link is invalid or incomplete');
      return;
    }
    setPending(true);
    try {
      await api.resetPassword({ token, password });
      setComplete(true);
      navigate('/reset-password', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="font-heading text-2xl font-bold">Choose a new password</h1>
          </div>
          {complete && <Alert><AlertTitle>Your password was changed. You can now log in.</AlertTitle></Alert>}
          {error && <Alert variant="destructive"><AlertTitle>{error}</AlertTitle></Alert>}
          {!complete && (
            <>
              <Field>
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <Input id="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
                <FieldDescription>At least 8 characters.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="reset-confirm-password">Confirm password</FieldLabel>
                <Input id="reset-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
              </Field>
              <Field><Button type="submit" disabled={pending}>{pending && <Spinner />}Change password</Button></Field>
            </>
          )}
          {complete && (
            <FieldDescription className="text-center"><Link to="/login" className="underline underline-offset-4">Go to login</Link></FieldDescription>
          )}
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
