import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './Login';

export default function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email')?.trim() ?? '';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!email) return;
    setPending(true);
    setError(null);
    try {
      await api.resendVerification({ email });
      setSent(true);
      setCooldown(60);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-heading text-2xl font-bold">Check your email</h1>
          <p className="text-sm text-balance text-muted-foreground">
            We sent a verification link{email ? <> to <strong>{email}</strong></> : null}. It expires in 24 hours.
          </p>
        </div>
        {sent && (
          <Alert>
            <AlertTitle>If that account is awaiting verification, a new email is on its way.</AlertTitle>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
        {email && (
          <Field>
            <Button type="button" variant="outline" disabled={pending || cooldown > 0} onClick={() => void resend()}>
              {pending && <Spinner />}
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
            </Button>
          </Field>
        )}
        <FieldDescription className="text-center">
          <Link to="/login" className="underline underline-offset-4">Back to login</Link>
        </FieldDescription>
      </FieldGroup>
    </AuthLayout>
  );
}
