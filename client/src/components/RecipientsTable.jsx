import { useEffect, useMemo, useState } from 'react';
import { formatTime } from '../utils.js';
import { StatusBadge } from './ui.jsx';

const PAGE_SIZE = 50;
const FILTERS = [
  ['all', 'All'],
  ['sent', 'Sent'],
  ['failed', 'Failed'],
  ['pending', 'Pending'],
  ['skipped', 'Skipped'],
];

const matchesFilter = (status, filter) => {
  if (filter === 'all') return true;
  if (filter === 'sent') return status === 'sent' || status === 'already';
  if (filter === 'skipped') return status === 'skipped' || status === 'invalid';
  if (filter === 'pending') return ['pending', 'sending', 'ready'].includes(status);
  return status === filter;
};

export default function RecipientsTable({ upload, job }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const started = job.status !== 'idle';

  const rows = useMemo(
    () =>
      upload.rows.map((row) => {
        const result = job.results[row.rowNumber];
        let status;
        if (result) status = result.already ? 'already' : result.status;
        else if (job.current?.rowNumber === row.rowNumber) status = 'sending';
        else if (started) status = 'pending';
        else status = row.alreadySent ? 'already' : row.valid ? 'ready' : 'invalid';
        return { ...row, status, error: result?.already ? '' : result?.error, at: result?.at };
      }),
    [upload.rows, job.results, job.current, started],
  );

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [key, rows.filter((r) => matchesFilter(r.status, key)).length])),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => matchesFilter(r.status, filter) && (!q || r.to.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(1), [filter, query]);
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasName = upload.rows.some((r) => r.name);

  return (
    <section className="card table-card">
      <header className="card-head">
        <div className="card-title">
          <h2>Recipients</h2>
          <p>Status of every row — the same status is marked in the "Email Status" column of your Excel file.</p>
        </div>
      </header>
      <div className="card-body">
        <div className="table-toolbar">
          <div className="tabs">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
                {label} <span className="count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <input className="search" placeholder="Search email / name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                {hasName && <th>Name</th>}
                <th>Email</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.rowNumber} className={row.status === 'sending' ? 'row-active' : ''}>
                  <td className="muted">{row.rowNumber}</td>
                  {hasName && <td>{row.name}</td>}
                  <td className="mono">{row.to || <span className="muted">(empty)</span>}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="details">
                    {row.error ? <span className="text-danger">{row.error}</span> : row.status === 'sent' ? formatTime(row.at) : ''}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={hasName ? 5 : 4} className="empty">
                    No rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="pager">
            <button type="button" className="btn-ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              ‹ Prev
            </button>
            <span>
              Page {currentPage} / {pageCount}
            </span>
            <button type="button" className="btn-ghost" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
              Next ›
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
