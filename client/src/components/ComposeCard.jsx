import { useRef, useState } from 'react';
import { formatBytes, renderTemplate, unknownPlaceholders } from '../utils.js';
import { Alert, Card, Dropzone } from './ui.jsx';

const DELAYS = [
  [500, '0.5 sec'],
  [1000, '1 sec'],
  [1500, '1.5 sec (recommended)'],
  [2000, '2 sec'],
  [3000, '3 sec'],
  [5000, '5 sec'],
  [10000, '10 sec'],
];

export default function ComposeCard({ config, compose, setCompose, attachments, setAttachments, upload, disabled }) {
  const bodyRef = useRef(null);
  const [tab, setTab] = useState('write');
  const [attachError, setAttachError] = useState('');

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setCompose((c) => ({ ...c, [key]: key === 'delayMs' ? Number(value) : value }));
  };

  const insertPlaceholder = (header) => {
    const token = `{{${header}}}`;
    const el = bodyRef.current;
    if (!el || tab !== 'write') {
      setCompose((c) => ({ ...c, body: c.body + token }));
      return;
    }
    const { selectionStart: start, selectionEnd: end } = el;
    setCompose((c) => ({ ...c, body: c.body.slice(0, start) + token + c.body.slice(end) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const maxBytes = config.limits.maxAttachmentTotalMb * 1024 * 1024;
  const totalSize = attachments.reduce((sum, f) => sum + f.size, 0);

  const addFiles = (files) => {
    setAttachError('');
    const merged = [...attachments];
    for (const file of files) {
      if (!merged.some((f) => f.name === file.name && f.size === file.size)) merged.push(file);
    }
    if (merged.length > config.limits.maxAttachments) {
      setAttachError(`A maximum of ${config.limits.maxAttachments} attachments is allowed.`);
      return;
    }
    if (merged.reduce((sum, f) => sum + f.size, 0) > maxBytes) {
      setAttachError(`Total attachment size cannot exceed ${config.limits.maxAttachmentTotalMb} MB.`);
      return;
    }
    setAttachments(merged);
  };

  const removeFile = (index) => setAttachments((list) => list.filter((_, i) => i !== index));

  const sample = upload?.sample ?? {};
  const unknown = upload ? unknownPlaceholders(`${compose.subject}\n${compose.body}`, upload.headers) : [];
  const previewBody = renderTemplate(compose.body, sample, compose.isHtml);

  return (
    <Card step={3} done={Boolean(compose.subject.trim() && compose.body.trim())} title="Email Compose" subtitle="Subject, message and attachments.">
      <div className="grid-2">
        <label className="field">
          <span>From name (optional)</span>
          <input
            placeholder={config.defaultFromName || 'Your name / company'}
            value={compose.fromName}
            onChange={set('fromName')}
            maxLength={100}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Reply-To (optional)</span>
          <input
            type="email"
            placeholder="replies@company.com"
            value={compose.replyTo}
            onChange={set('replyTo')}
            disabled={disabled}
          />
        </label>
      </div>

      <label className="field">
        <span>Subject</span>
        <input
          placeholder="Hello {{Name}}, an important update"
          value={compose.subject}
          onChange={set('subject')}
          maxLength={500}
          disabled={disabled}
        />
      </label>

      {upload && (
        <div className="placeholders">
          <span>Personalize (click to insert):</span>
          {upload.headers.map((h) => (
            <button key={h} type="button" className="chip" onClick={() => insertPlaceholder(h)} disabled={disabled}>
              {`{{${h}}}`}
            </button>
          ))}
        </div>
      )}

      <div className="editor">
        <div className="editor-bar">
          <div className="tabs">
            <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>
              Write
            </button>
            <button type="button" className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
              Preview
            </button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={compose.isHtml} onChange={set('isHtml')} disabled={disabled} />
            <span>HTML mode</span>
          </label>
        </div>

        {tab === 'write' ? (
          <textarea
            ref={bodyRef}
            rows={10}
            placeholder={
              compose.isHtml
                ? '<p>Hi {{Name}},</p>\n<p>Your message here…</p>'
                : 'Hi {{Name}},\n\nWrite your message here…\n\nRegards'
            }
            value={compose.body}
            onChange={set('body')}
            disabled={disabled}
          />
        ) : (
          <div className="preview">
            <div className="preview-subject">
              <small>Subject</small>
              <b>{renderTemplate(compose.subject, sample) || '—'}</b>
            </div>
            {compose.isHtml ? (
              <iframe title="Email preview" sandbox="" srcDoc={previewBody} className="preview-frame" />
            ) : (
              <div className="preview-text">{previewBody || 'Nothing written yet.'}</div>
            )}
            {upload && <small className="hint">Preview uses data from the first valid row.</small>}
          </div>
        )}
      </div>

      {unknown.length > 0 && (
        <Alert kind="warning">
          These placeholders don't match any Excel header: {unknown.map((u) => `{{${u}}}`).join(', ')}
        </Alert>
      )}

      <div className="field">
        <span>
          Attachments{' '}
          <small className="muted">
            ({formatBytes(totalSize)} / {config.limits.maxAttachmentTotalMb} MB · max {config.limits.maxAttachments} files)
          </small>
        </span>
        <Dropzone multiple compact onFiles={addFiles} disabled={disabled}>
          <div className="dz-content dz-row">
            <span className="dz-icon-sm">📎</span>
            <span>
              <b>Drop files here</b> or click to add (PDF, images, docs…)
            </span>
          </div>
        </Dropzone>
        {attachments.length > 0 && (
          <ul className="file-list">
            {attachments.map((file, i) => (
              <li key={`${file.name}-${file.size}`}>
                <span className="file-name">{file.name}</span>
                <small>{formatBytes(file.size)}</small>
                <button type="button" className="btn-icon" aria-label={`Remove ${file.name}`} onClick={() => removeFile(i)} disabled={disabled}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <Alert>{attachError}</Alert>
      </div>

      <div className="grid-2 settings">
        <label className="field">
          <span>Delay between emails</span>
          <select value={compose.delayMs} onChange={set('delayMs')} disabled={disabled}>
            {DELAYS.map(([ms, label]) => (
              <option key={ms} value={ms}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={compose.skipAlreadySent} onChange={set('skipAlreadySent')} disabled={disabled} />
          <span>Skip rows already marked ✔ Sent</span>
        </label>
      </div>
    </Card>
  );
}
