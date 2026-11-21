import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Lock, Send, User } from 'lucide-react';
import { useAuth } from '../components/AuthContext.jsx';
import { Alert } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const redirectTo =
    location.pathname && location.pathname !== '/login'
      ? `${location.pathname}${location.search || ''}`
      : '/';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Enter both your username and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign-in failed. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(60rem_40rem_at_20%_-10%,rgb(140_60_255/0.14),transparent_60%),radial-gradient(50rem_30rem_at_100%_0%,rgb(33_180_255/0.09),transparent_60%)]"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-linear-to-br from-[#c23cff] to-[#21b4ff] shadow-[0_8px_24px_-6px_rgb(194_60_255/0.75)]">
            <Send className="h-5 w-5 text-white" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Internship Outreach</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to access your dashboard</p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error ? (
              <Alert tone="error" title="Sign-in failed">
                {error}
              </Alert>
            ) : null}

            <div>
              <label htmlFor="login-username" className="label">
                Username
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter your username"
                  className="input pl-10"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="label">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="input pr-11 pl-10"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full py-3" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                'Sign in to Dashboard'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Local workspace session · Protected by HttpOnly signed cookies
        </p>
      </div>
    </div>
  );
}
