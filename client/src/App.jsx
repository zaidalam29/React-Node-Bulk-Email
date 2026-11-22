import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, withToken } from './api.js';
import ComposeCard from './components/ComposeCard.jsx';
import GmailCard from './components/GmailCard.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import RecipientsTable from './components/RecipientsTable.jsx';
import UploadCard from './components/UploadCard.jsx';
import { Alert, Spinner } from './components/ui.jsx';
import { useJobStream } from './hooks/useJobStream.js';

const DRAFT_KEY = 'bulk_mailer_draft_v1';
const EMAIL_KEY = 'bulk_mailer_email';

const DEFAULT_COMPOSE = {
  fromName: '',
  replyTo: '',
  subject: '',
  body: '',
  isHtml: false,
  delayMs: 1500,
  skipAlreadySent: true,
};

function loadDraft() {
  try {
    return { ...DEFAULT_COMPOSE, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') };
  } catch {
    return DEFAULT_COMPOSE;
  }
}

function TokenGate({ onSubmit, error }) {
  const [value, setValue] = useState('');
  return (
    <div className="center-screen">
      <form
        className="card gate"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value.trim());
        }}
      >
        <h2>🔒 Access token</h2>
        <p className="muted">This server is protected. Enter the access token provided by your admin.</p>
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Access token" />
        <Alert>{error}</Alert>
        <button className="btn-primary" type="submit" disabled={!value.trim()}>
          Continue
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [bootError, setBootError] = useState('');
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [creds, setCreds] = useState(() => ({ email: localStorage.getItem(EMAIL_KEY) || '', appPassword: '' }));
  const [verified, setVerified] = useState(null);
  const [upload, setUpload] = useState(null);
  const [compose, setCompose] = useState(loadDraft);
  const [attachments, setAttachments] = useState([]);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState('');

  const { job, connection } = useJobStream(upload?.sessionId);
  const active = job.status === 'running' || job.status === 'paused';

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api('/config');
      setConfig(cfg);
      setNeedsToken(cfg.authRequired && !getToken());
      setCompose((c) => (c.delayMs ? c : { ...c, delayMs: cfg.defaultDelayMs }));
    } catch (err) {
      setBootError(err.message);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(compose));
  }, [compose]);

  useEffect(() => {
    localStorage.setItem(EMAIL_KEY, creds.email);
  }, [creds.email]);

  useEffect(() => {
    const c = job.counters;
    document.title =
      active && c ? `(${c.sent + c.failed + c.skipped}/${c.total}) Sending… · Bulk Mailer` : 'Bulk Mailer';
  }, [job.counters, active]);

  useEffect(() => {
    if (!active) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const submitToken = async (token) => {
    setToken(token);
    try {
      await api('/auth');
    } catch (err) {
      setToken('');
      setTokenError(err.message);
      return;
    }
    setTokenError('');
    setNeedsToken(false);
  };

  const removeUpload = async () => {
    const id = upload?.sessionId;
    setUpload(null);
    setActionError('');
    if (id) await api(`/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const start = async () => {
    const recipients = upload.counts.valid - (compose.skipAlreadySent ? upload.counts.alreadySent : 0);
    const confirmText =
      job.status === 'idle'
        ? `About ${Math.max(recipients, 0)} recipients will receive this email. Start sending?`
        : 'Resend to all recipients that have not received the email yet (failed / pending)?';
    if (!window.confirm(confirmText)) return;

    setStarting(true);
    setActionError('');
    const form = new FormData();
    const fields = { ...compose, email: creds.email, appPassword: creds.appPassword };
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const file of attachments) form.append('attachments', file);
    try {
      await api(`/sessions/${upload.sessionId}/start`, { method: 'POST', form });
    } catch (err) {
      setActionError(err.message);
      if (err.status === 404) setUpload(null);
    } finally {
      setStarting(false);
    }
  };

  const control = (action) => async () => {
    if (action === 'cancel' && !window.confirm('Cancel sending? Emails already sent will stay marked in the Excel file.')) return;
    setActionError('');
    try {
      await api(`/sessions/${upload.sessionId}/${action}`, { method: 'POST' });
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (bootError) {
    return (
      <div className="center-screen">
        <div className="card gate">
          <h2>Could not connect to the server</h2>
          <Alert>{bootError}</Alert>
          <button
            className="btn-primary"
            onClick={() => {
              setBootError('');
              loadConfig();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  if (needsToken) return <TokenGate onSubmit={submitToken} error={tokenError} />;

  const hasCreds = Boolean((creds.email.trim() && creds.appPassword.trim()) || config.envCredentials);
  const missing = [
    !hasCreds && 'Enter your Gmail address and App Password',
    !upload && 'Upload the recipients Excel file',
    !compose.subject.trim() && 'Write a subject',
    !compose.body.trim() && 'Write the email body',
  ].filter(Boolean);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">✉</span>
          <div>
            <h1>Bulk Mailer</h1>
            <p>Email every contact in your Excel sheet via Gmail — with attachments and live tracking.</p>
          </div>
        </div>
        {config.authRequired && (
          <button
            type="button"
            className="btn-ghost light"
            onClick={() => {
              setToken('');
              setNeedsToken(true);
            }}
          >
            Logout
          </button>
        )}
      </header>

      <main className="layout">
        <div className="col-main">
          <GmailCard
            config={config}
            creds={creds}
            setCreds={setCreds}
            verified={verified}
            setVerified={setVerified}
            disabled={active}
          />
          <UploadCard config={config} upload={upload} onUploaded={setUpload} onRemove={removeUpload} disabled={active || starting} />
          <ComposeCard
            config={config}
            compose={compose}
            setCompose={setCompose}
            attachments={attachments}
            setAttachments={setAttachments}
            upload={upload}
            disabled={active || starting}
          />
        </div>
        <aside className="col-side">
          <ProgressPanel
            job={job}
            connection={connection}
            upload={upload}
            missing={missing}
            starting={starting}
            error={actionError}
            downloadUrl={upload ? withToken(`/api/sessions/${upload.sessionId}/download`) : ''}
            onStart={start}
            onPause={control('pause')}
            onResume={control('resume')}
            onCancel={control('cancel')}
          />
        </aside>
      </main>

      {upload && (
        <div className="layout-full">
          <RecipientsTable upload={upload} job={job} />
        </div>
      )}

      <footer className="footer">
        Tip: Gmail allows about 500 emails/day on personal accounts and about 2,000/day on Google Workspace.
      </footer>
    </div>
  );
}
