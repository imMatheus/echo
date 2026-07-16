import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { FieldDescription, FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './Login';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token') ?? '';
    if (!token) {
      setError('This verification link is invalid or incomplete');
      return;
    }
    void api
      .verifyEmail({ token })
      .then(async () => {
        await refresh();
        navigate('/dashboard', { replace: true });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [navigate, params, refresh]);

  return (
    <AuthLayout>
      <FieldGroup>
        <div className="flex flex-col items-center gap-3 text-center">
          {!error && <Spinner className="size-7" />}
          <h1 className="font-heading text-2xl font-bold">{error ? 'Verification failed' : 'Verifying your email'}</h1>
          {!error && <p className="text-sm text-muted-foreground">This should only take a moment.</p>}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
        {error && (
          <FieldDescription className="text-center">
            <Link to="/login" className="underline underline-offset-4">Back to login</Link>
          </FieldDescription>
        )}
      </FieldGroup>
    </AuthLayout>
  );
}
