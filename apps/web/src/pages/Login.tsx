import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { ServerMeta } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';
import { LogoMark } from '../components/icons';

export default function LoginPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMeta()
      .then(setMeta)
      .catch(() => {
        // meta is decorative here; ignore failures
      });
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.login({ email: email.trim(), password });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  const showSignupLink = meta === null || meta.signupEnabled;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoMark size={40} />
          <span className="wordmark">Echo</span>
          <span className="tagline">The open context layer for AI apps</span>
        </div>

        <form onSubmit={(e) => void submit(e)}>
          {error && <div className="form-error">{error}</div>}
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
            {pending && <Spinner size={13} />}
            Log in
          </button>
        </form>

        {showSignupLink && (
          <div className="auth-alt">
            No account? <Link to="/signup">Sign up</Link>
          </div>
        )}
      </div>
      <div className="auth-footer">{meta ? `${meta.name} v${meta.version}` : ' '}</div>
    </div>
  );
}
