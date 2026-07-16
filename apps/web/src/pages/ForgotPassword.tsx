import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './Login';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.forgotPassword({ email: email.trim() });
      setSent(true);
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
            <h1 className="font-heading text-2xl font-bold">Reset your password</h1>
            <p className="text-sm text-muted-foreground">Enter your email and we’ll send a reset link.</p>
          </div>
          {sent && (
            <Alert>
              <AlertTitle>If an account exists for that address, a reset email is on its way.</AlertTitle>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive"><AlertTitle>{error}</AlertTitle></Alert>
          )}
          {!sent && (
            <>
              <Field>
                <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                <Input id="forgot-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus maxLength={254} />
              </Field>
              <Field>
                <Button type="submit" disabled={pending}>{pending && <Spinner />}Send reset link</Button>
              </Field>
            </>
          )}
          <FieldDescription className="text-center">
            <Link to="/login" className="underline underline-offset-4">Back to login</Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
