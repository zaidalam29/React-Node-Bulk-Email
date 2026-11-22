import { useRef, useState } from 'react';

export function Card({ step, title, subtitle, right, done, className = '', children }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        {step != null && <span className={`step ${done ? 'step-done' : ''}`}>{done ? '✓' : step}</span>}
        <div className="card-title">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {right && <div className="card-right">{right}</div>}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export const Spinner = ({ small }) => <span className={`spinner ${small ? 'spinner-sm' : ''}`} aria-hidden="true" />;

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Dropzone({ accept, multiple = false, disabled = false, onFiles, children, compact = false }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const open = () => !disabled && inputRef.current?.click();

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${compact ? 'compact' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </div>
  );
}

export const STATUS_META = {
  sent: { label: 'Sent', icon: '✔', tone: 'success' },
  failed: { label: 'Failed', icon: '✘', tone: 'danger' },
  skipped: { label: 'Skipped', icon: '⚠', tone: 'warning' },
  already: { label: 'Already sent', icon: '✔', tone: 'muted-success' },
  sending: { label: 'Sending…', icon: null, tone: 'info' },
  pending: { label: 'Not sent', icon: '•', tone: 'muted' },
  ready: { label: 'Ready', icon: '•', tone: 'muted' },
  invalid: { label: 'Invalid email', icon: '!', tone: 'danger' },
};

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`badge badge-${meta.tone}`}>
      {status === 'sending' ? <Spinner small /> : <span aria-hidden="true">{meta.icon}</span>}
      {meta.label}
    </span>
  );
}
