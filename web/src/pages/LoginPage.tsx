import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import type { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { IconCheck } from '../components/Icons';

export function LoginPage() {
  const { user, ready, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Login failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="org-rail login-org">
        <div className="org-rail-inner">
          <span className="org-name">Newtonite</span>
          <span className="org-sep" aria-hidden="true">
            /
          </span>
          <span>Operations platform</span>
        </div>
      </div>

      <div className="login-frame">
        <aside className="login-intro">
          <div className="eyebrow">Newtonite · Operations platform</div>
          <h1>Operations Under Pressure</h1>
          <p className="lead">
            A shared queue for operational work. You create items, claim them,
            move them through a status path, and leave a history every step.
          </p>
          <ul>
            <li>
              <strong>
                <IconCheck className="icon" /> Claim safely
              </strong>
              Only one person wins if two claim at once.
            </li>
            <li>
              <strong>
                <IconCheck className="icon" /> Lead approval
              </strong>
              Payments and compliance need a Lead who is not the assignee.
            </li>
            <li>
              <strong>
                <IconCheck className="icon" /> Full history
              </strong>
              Status, owner, and priority changes are logged.
            </li>
          </ul>
        </aside>

        <form className="login-box" onSubmit={onSubmit}>
          <h2>Sign in</h2>
          <p className="sub">Use a seeded demo account from the project README.</p>

          {error && <div className="error-box">{error}</div>}

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" disabled={pending} style={{ width: '100%' }}>
            {pending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
