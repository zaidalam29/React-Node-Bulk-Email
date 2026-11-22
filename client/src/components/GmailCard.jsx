import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Card, Spinner } from './ui.jsx';

export default function GmailCard({ config, creds, setCreds, verified, setVerified, disabled }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (key) => (e) => {
    setCreds((c) => ({ ...c, [key]: e.target.value }));
    setVerified(null);
    setError('');
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api('/verify', { method: 'POST', json: creds });
      setVerified(res.email);
    } catch (err) {
      setVerified(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canVerify = (creds.email.trim() && creds.appPassword.trim()) || config.envCredentials;

  return (
    <Card
      step={1}
      done={Boolean(verified)}
      title="Gmail Account"
      subtitle="Enter your Gmail address and an App Password (not your regular password)."
      right={
        <button type="button" className="btn-link" onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? 'Hide help' : 'How to create an App Password?'}
        </button>
      }
    >
      {showHelp && (
        <ol className="help-steps">
          <li>
            Go to Google Account → <b>Security</b> and turn on <b>2-Step Verification</b>.
          </li>
          <li>
            Open{' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
              myaccount.google.com/apppasswords
            </a>
            .
          </li>
          <li>
            Enter an app name (e.g. <i>Bulk Mailer</i>) and click <b>Create</b>.
          </li>
          <li>Copy the 16-character password and paste it below.</li>
        </ol>
      )}

      {config.envCredentials && (
        <p className="hint">
          A default account is configured on the server (<b>{config.envGmailUser}</b>). Leave these fields empty to use it.
        </p>
      )}

      <div className="grid-2">
        <label className="field">
          <span>Gmail address</span>
          <input
            type="email"
            autoComplete="username"
            placeholder="you@gmail.com"
            value={creds.email}
            onChange={update('email')}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>App Password</span>
          <div className="input-group">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="xxxx xxxx xxxx xxxx"
              value={creds.appPassword}
              onChange={update('appPassword')}
              disabled={disabled}
            />
            <button type="button" className="btn-ghost" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
      </div>

      <div className="row-between">
        <button type="button" className="btn-secondary" onClick={verify} disabled={busy || disabled || !canVerify}>
          {busy ? (
            <>
              <Spinner small /> Checking…
            </>
          ) : (
            'Verify connection'
          )}
        </button>
        {verified && <span className="ok-text">✔ Connected as {verified}</span>}
      </div>
      <Alert>{error}</Alert>
    </Card>
  );
}
