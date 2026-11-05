import { useState, type FormEvent } from 'react';
import { supabase } from './supabase';

/** Email and password sign-in through Supabase Auth. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(
        signInError.status === 400
          ? 'That email and password did not match. Check both and try again.'
          : 'Sign-in is not available right now. Try again in a minute.',
      );
    }
  }

  return (
    <main className="signin">
      <form
        className="signin__card"
        onSubmit={submit}
        aria-describedby={error ? 'signin-error' : undefined}
      >
        <div className="brand">
          <span className="brand__tile">
            <img src="/fifth-stone-dev-icon.png" alt="" width={427} height={355} />
          </span>
          <span className="brand__text">
            <span className="brand__name">Fifth Stone Connect</span>
            <span className="brand__sub">from Fifth Stone Dev</span>
          </span>
        </div>
        <h1 className="signin__title">Sign in</h1>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p id="signin-error" className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
