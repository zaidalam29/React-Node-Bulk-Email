import { useState } from 'react';
import { api, withToken } from '../api.js';
import { Alert, Card, Dropzone, Spinner } from './ui.jsx';

export default function UploadCard({ config, upload, onUploaded, onRemove, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFiles = async ([file]) => {
    setError('');
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please upload an .xlsx Excel file.');
      return;
    }
    if (file.size > config.limits.maxExcelSizeMb * 1024 * 1024) {
      setError(`Excel file must be smaller than ${config.limits.maxExcelSizeMb} MB.`);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try {
      onUploaded(await api('/sessions', { method: 'POST', form }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sampleLink = (
    <a className="btn-link" href={withToken('/api/sample')} download>
      Download sample Excel
    </a>
  );

  return (
    <Card
      step={2}
      done={Boolean(upload)}
      title="Recipients Excel"
      subtitle='First row must contain headers (e.g. "Name", "Email"). Each row receives one email.'
      right={sampleLink}
    >
      {!upload ? (
        <Dropzone accept=".xlsx" onFiles={handleFiles} disabled={busy || disabled}>
          {busy ? (
            <div className="dz-content">
              <Spinner />
              <p>Reading Excel file…</p>
            </div>
          ) : (
            <div className="dz-content">
              <div className="dz-icon">📊</div>
              <p>
                <b>Drag &amp; drop your Excel file here</b> or click to browse
              </p>
              <small>.xlsx · max {config.limits.maxExcelSizeMb} MB</small>
            </div>
          )}
        </Dropzone>
      ) : (
        <div className="upload-summary">
          <div className="file-chip">
            <span className="file-icon">📊</span>
            <div>
              <b>{upload.fileName}</b>
              <small>
                Email column: <code>{upload.emailHeader}</code>
              </small>
            </div>
            <button type="button" className="btn-ghost" onClick={onRemove} disabled={disabled}>
              Change file
            </button>
          </div>
          <div className="mini-stats">
            <div>
              <b>{upload.counts.total}</b>
              <span>Total rows</span>
            </div>
            <div className="tone-success">
              <b>{upload.counts.valid}</b>
              <span>Valid emails</span>
            </div>
            <div className="tone-danger">
              <b>{upload.counts.invalid}</b>
              <span>Invalid / empty</span>
            </div>
            <div className="tone-info">
              <b>{upload.counts.alreadySent}</b>
              <span>Already sent</span>
            </div>
          </div>
        </div>
      )}
      <Alert>{error}</Alert>
    </Card>
  );
}
