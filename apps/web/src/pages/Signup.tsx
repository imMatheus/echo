import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { ServerMeta } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';
import { LogoMark } from '../components/icons';

export default function SignupPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMeta()
      .then(setMeta)
      .catch(() => {
        // decorative
      });
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const signupDisabled = meta !== null && !meta.signupEnabled;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setPending(true);
    try {
      await api.signup({ name: name.trim(), email: email.trim(), password });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoMark size={40} />
          <span className="wordmark">Echo</span>
          <span className="tagline">Create your account</span>
        </div>

        {signupDisabled ? (
          <div className="inline-note" style={{ textAlign: 'center' }}>
            Sign-ups are disabled on this server.
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            {error && <div className="form-error">{error}</div>}
            <div className="field">
              <label htmlFor="signup-name">Name</label>
              <input
                id="signup-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <div className="hint">At least 8 characters.</div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending && <Spinner size={13} />}
              Create account
            </button>
          </form>
        )}

        <div className="auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
      <div className="auth-footer">{meta ? `${meta.name} v${meta.version}` : ' '}</div>
    </div>
  );
}
