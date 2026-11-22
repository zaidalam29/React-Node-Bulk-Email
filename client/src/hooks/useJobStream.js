import { useEffect, useReducer, useState } from 'react';
import { withToken } from '../api.js';

const LOG_LIMIT = 500;

export const initialJob = {
  status: 'idle',
  message: '',
  counters: null,
  current: null,
  results: {},
  log: [],
};

function fromSnapshot(snap) {
  const results = Object.fromEntries(snap.results.map((r) => [r.rowNumber, r]));
  const log = snap.results
    .filter((r) => !r.already)
    .sort((a, b) => b.at - a.at)
    .slice(0, LOG_LIMIT);
  return { status: snap.status, message: snap.message, counters: snap.counters, current: snap.current, results, log };
}

function reducer(state, { event, data }) {
  switch (event) {
    case 'reset':
      return initialJob;
    case 'snapshot':
      return fromSnapshot(data);
    case 'status':
      return { ...state, status: data.status, message: data.message, counters: data.counters ?? state.counters };
    case 'sending':
      return { ...state, current: data };
    case 'result': {
      const { counters, ...result } = data;
      return {
        ...state,
        counters,
        current: state.current?.rowNumber === result.rowNumber ? null : state.current,
        results: { ...state.results, [result.rowNumber]: result },
        log: [result, ...state.log].slice(0, LOG_LIMIT),
      };
    }
    default:
      return state;
  }
}

export function useJobStream(sessionId) {
  const [job, dispatch] = useReducer(reducer, initialJob);
  const [connection, setConnection] = useState('idle');

  useEffect(() => {
    dispatch({ event: 'reset' });
    if (!sessionId) {
      setConnection('idle');
      return undefined;
    }

    const source = new EventSource(withToken(`/api/sessions/${sessionId}/events`));
    setConnection('connecting');
    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');

    for (const event of ['snapshot', 'status', 'sending', 'result']) {
      source.addEventListener(event, (e) => dispatch({ event, data: JSON.parse(e.data) }));
    }
    return () => source.close();
  }, [sessionId]);

  return { job, connection };
}
