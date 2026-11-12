import { useState, type FormEvent } from 'react';
import { supabase } from './supabase';

/**
 * Choosing a password from a one-time link (Iteration 1). Fifth Stone Dev's `create` and
 * `add-person` commands print the link; opening it signs the person in once, and this screen sets
 * the password they will use from then on. Supabase Auth enforces the minimum length too.
 */

const MIN_LENGTH = 10;

export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== again) {
      setError('The two passwords are different. Type the same one twice.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(
        "That password wasn't accepted. Try a longer one, or ask Fifth Stone Dev for a new link.",
      );
      return;
    }
    onDone();
  }

  return (
    <main className="signin">
      <form
        className="signin__card"
        onSubmit={submit}
        aria-describedby={error ? 'password-error' : undefined}
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
        <h1 className="signin__title">Choose your password</h1>
        <p className="meta">You will use it with your email to sign in from now on.</p>
        <label className="field">
          <span className="field__label">New password</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="meta">At least {MIN_LENGTH} characters.</span>
        </label>
        <label className="field">
          <span className="field__label">Type it again</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        {error && (
          <p id="password-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </main>
  );
}
