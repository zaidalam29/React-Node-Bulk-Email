import { formatTime } from '../utils.js';
import { Alert, Spinner, StatusBadge } from './ui.jsx';

const STATUS_LABEL = {
  idle: 'Ready',
  running: 'Sending',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
};

const MESSAGE_KIND = { completed: 'success', stopped: 'error', cancelled: 'warning', paused: 'info' };

export default function ProgressPanel({
  job,
  connection,
  upload,
  missing,
  starting,
  error,
  downloadUrl,
  onStart,
  onPause,
  onResume,
  onCancel,
}) {
  const c = job.counters;
  const done = c ? c.sent + c.failed + c.skipped : 0;
  const percent = c?.total ? Math.round((done / c.total) * 100) : 0;
  const active = job.status === 'running' || job.status === 'paused';
  const finished = ['completed', 'cancelled', 'stopped'].includes(job.status);
  const retryable = finished && c && c.failed + c.pending > 0;

  return (
    <section className="card progress-card">
      <header className="card-head">
        <span className="step">4</span>
        <div className="card-title">
          <h2>Send &amp; Track</h2>
          <p>Live status of every email appears here.</p>
        </div>
        <div className="card-right">
          <span className={`pill pill-${job.status}`}>
            {job.status === 'running' && <span className="pulse" />}
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </div>
      </header>

      <div className="card-body">
        {c && (
          <>
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill sent" style={{ width: `${(c.sent / c.total) * 100}%` }} />
                <div className="progress-fill failed" style={{ width: `${(c.failed / c.total) * 100}%` }} />
                <div className="progress-fill skipped" style={{ width: `${(c.skipped / c.total) * 100}%` }} />
              </div>
              <div className="progress-label">
                <b>{percent}%</b>
                <span>
                  {done} / {c.total} processed
                </span>
              </div>
            </div>

            <div className="stats">
              <div className="stat tone-success">
                <b>{c.sent}</b>
                <span>Sent</span>
              </div>
              <div className="stat tone-danger">
                <b>{c.failed}</b>
                <span>Failed</span>
              </div>
              <div className="stat tone-warning">
                <b>{c.skipped}</b>
                <span>Skipped</span>
              </div>
              <div className="stat">
                <b>{c.pending}</b>
                <span>Pending</span>
              </div>
            </div>
          </>
        )}

        {job.current && (
          <div className="now-sending">
            <Spinner small />
            <span>
              Sending to: <b>{job.current.to}</b> <small>(row {job.current.rowNumber})</small>
            </span>
          </div>
        )}

        <Alert kind={MESSAGE_KIND[job.status] ?? 'info'}>{job.message}</Alert>
        <Alert>{error}</Alert>
        {connection === 'reconnecting' && <Alert kind="warning">Live connection lost, reconnecting…</Alert>}

        {!active && missing.length > 0 && (
          <ul className="checklist">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="actions">
          {!active && (
            <button type="button" className="btn-primary btn-lg" onClick={onStart} disabled={starting || missing.length > 0}>
              {starting ? (
                <>
                  <Spinner small /> Starting…
                </>
              ) : retryable ? (
                '↻ Retry failed / remaining emails'
              ) : finished ? (
                '▶ Start again'
              ) : (
                `▶ Start Sending${upload ? ` (${upload.counts.valid})` : ''}`
              )}
            </button>
          )}
          {job.status === 'running' && (
            <button type="button" className="btn-secondary" onClick={onPause}>
              ❚❚ Pause
            </button>
          )}
          {job.status === 'paused' && (
            <button type="button" className="btn-primary" onClick={onResume}>
              ▶ Resume
            </button>
          )}
          {active && (
            <button type="button" className="btn-danger" onClick={onCancel}>
              ■ Cancel
            </button>
          )}
          {downloadUrl && job.status !== 'idle' && (
            <a className="btn-success" href={downloadUrl} download>
              ⬇ Download updated Excel
            </a>
          )}
        </div>

        <div className="log">
          <div className="log-head">
            <b>Live activity</b>
            <small>{job.log.length ? `${job.log.length} events` : ''}</small>
          </div>
          {job.log.length === 0 ? (
            <p className="log-empty">Once you start, the status of each email will appear here.</p>
          ) : (
            <ul>
              {job.log.map((entry) => (
                <li key={`${entry.rowNumber}-${entry.at}`} className={`log-item log-${entry.status}`}>
                  <StatusBadge status={entry.status} />
                  <div className="log-main">
                    <span className="log-to">{entry.to || '(empty)'}</span>
                    {entry.error && <span className="log-error">{entry.error}</span>}
                  </div>
                  <small className="log-meta">
                    Row {entry.rowNumber}
                    <br />
                    {formatTime(entry.at)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
