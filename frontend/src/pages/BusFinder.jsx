/**
 * BusFinder — find buses running between two stops with live arrival times.
 *
 * Stop inputs are controlled by the parent so the button can be enabled
 * as soon as both fields have text, regardless of whether the user selected
 * from the autocomplete dropdown or typed a stop code directly.
 */

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEBOUNCE_MS = 300;

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a stop code from whatever the user typed.
 * If the field was filled via autocomplete it looks like "09048 — BLK 97";
 * if the user typed a bare code it looks like "09048".
 * We take the leading word (digits + letters) in both cases.
 */
function extractCode(text) {
  const m = text.trim().match(/^(\S+)/);
  return m ? m[1] : text.trim();
}

// ── BusStopInput ──────────────────────────────────────────────────────────────
// Controlled autocomplete for bus stops.
// `value` / `onChange` manage the raw text (owned by parent).
// `onSelect` is called with the full stop object when the user picks from dropdown.

function BusStopInput({ id, label, placeholder, value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop,    setShowDrop]    = useState(false);
  const [active,      setActive]      = useState(-1);

  const debounceRef = useRef(null);
  const abortRef    = useRef(null);
  const skipRef     = useRef(false);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (skipRef.current) { skipRef.current = false; return; }
    if (value.trim().length < 2) {
      abortRef.current?.abort();
      setSuggestions([]);
      setShowDrop(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const { data } = await axios.get(`${API_BASE}/api/bus-stops/search`, {
          params: { q: value.trim() },
          signal: abortRef.current.signal,
        });
        setSuggestions(data);
        setShowDrop(data.length > 0);
        setActive(-1);
      } catch (err) {
        if (err.code === 'ERR_CANCELED') return;
        setSuggestions([]);
        setShowDrop(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  function select(stop) {
    abortRef.current?.abort();
    skipRef.current = true;
    onChange(`${stop.code} — ${stop.name}`);
    onSelect(stop);
    setShowDrop(false);
    setSuggestions([]);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (!showDrop) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(suggestions[active]);
    } else if (e.key === 'Escape') {
      setShowDrop(false);
    }
  }

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="autocomplete-wrapper">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={e => { onChange(e.target.value); onSelect(null); }}
          onFocus={() => suggestions.length > 0 && setShowDrop(true)}
          onBlur={() => setShowDrop(false)}
          onKeyDown={onKeyDown}
        />
        {showDrop && (
          <ul className="suggestion-list" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={i}
                role="option"
                aria-selected={i === active}
                className={`suggestion-item${i === active ? ' active' : ''}`}
                onMouseDown={() => select(s)}
              >
                <span className="suggestion-name">{s.code} — {s.name}</span>
                <span className="suggestion-address">{s.road}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── ArrivalChip ───────────────────────────────────────────────────────────────

function ArrivalChip({ minutes }) {
  if (minutes === null || minutes === undefined)
    return <span className="arrival-chip arrival-chip--none">—</span>;
  if (minutes <= 0)
    return <span className="arrival-chip arrival-chip--now">Arr</span>;
  const cls = minutes <= 3 ? 'arrival-chip--soon'
            : minutes <= 9 ? 'arrival-chip--mid'
                           : 'arrival-chip--later';
  return <span className={`arrival-chip ${cls}`}>{minutes} min</span>;
}

// ── BusFinder page ────────────────────────────────────────────────────────────

export default function BusFinder() {
  // Raw text in each input (controlled by this component)
  const [fromText, setFromText] = useState('');
  const [toText,   setToText]   = useState('');
  // Full stop object if the user selected from the autocomplete dropdown
  const [fromStop, setFromStop] = useState(null);
  const [toStop,   setToStop]   = useState(null);

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Enable the button as soon as both fields have enough text —
  // no dropdown selection required (typed codes work too).
  const canSearch = fromText.trim().length >= 2 && toText.trim().length >= 2;

  // Derive stop codes: prefer the code from the dropdown selection,
  // fall back to the leading word the user typed (handles bare codes like "09048").
  const fromCode = fromStop?.code ?? extractCode(fromText);
  const toCode   = toStop?.code   ?? extractCode(toText);

  async function handleFind(e) {
    e.preventDefault();
    if (!canSearch) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const { data } = await axios.get(`${API_BASE}/api/bus-between`, {
        params: { from_stop: fromCode, to_stop: toCode },
      });
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Failed to fetch bus arrivals.');
    } finally {
      setLoading(false);
    }
  }

  // Display labels in the results heading
  const fromLabel = fromStop ? `${fromStop.code} — ${fromStop.name}` : fromCode;
  const toLabel   = toStop   ? `${toStop.code} — ${toStop.name}`     : toCode;

  return (
    <main className="app-main">

      {/* ── Search panel ───────────────────────────────────────────────── */}
      <section className="search-panel">
        <form className="search-form" onSubmit={handleFind}>
          <div className="search-row">

            <BusStopInput
              id="bf-from"
              label="Board at (Stop A)"
              placeholder="e.g. BLK 97 or 09048"
              value={fromText}
              onChange={setFromText}
              onSelect={setFromStop}
            />

            <BusStopInput
              id="bf-to"
              label="Alight at (Stop B)"
              placeholder="e.g. Farrer Road MRT or 09238"
              value={toText}
              onChange={setToText}
              onSelect={setToStop}
            />

            <button
              type="submit"
              className="search-btn"
              disabled={loading || !canSearch}
            >
              {loading ? 'Searching…' : 'Find Buses'}
            </button>

          </div>
        </form>
      </section>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <section className="routes-section">

        {loading && (
          <div className="status status--loading">
            <span className="spinner" aria-hidden="true" />
            Checking arrivals…
          </div>
        )}

        {error && !loading && (
          <div className="status status--error" role="alert">{error}</div>
        )}

        {!results && !loading && !error && (
          <div className="status status--hint">
            Enter a boarding stop and an alighting stop above, then click{' '}
            <strong>Find Buses</strong>. You can type a stop code directly
            (e.g. <code>09048</code>) or search by name.
          </div>
        )}

        {results && !loading && (
          results.buses.length === 0 ? (
            <div className="status status--hint">
              No direct buses found from <strong>{fromLabel}</strong> to{' '}
              <strong>{toLabel}</strong> in this direction.
            </div>
          ) : (
            <div className="bf-results">
              <div className="bf-heading">
                <h2 className="bf-title">
                  Buses from <span className="bf-code">{fromCode}</span> to{' '}
                  <span className="bf-code">{toCode}</span>
                </h2>
                {(fromStop || toStop) && (
                  <p className="bf-subtitle">
                    {fromStop?.name ?? fromCode}
                    {fromStop?.road ? ` (${fromStop.road})` : ''}
                    {' → '}
                    {toStop?.name ?? toCode}
                    {toStop?.road ? ` (${toStop.road})` : ''}
                  </p>
                )}
              </div>

              <table className="bf-table">
                <thead>
                  <tr>
                    <th>Bus</th>
                    <th>Next</th>
                    <th>2nd</th>
                    <th>3rd</th>
                  </tr>
                </thead>
                <tbody>
                  {results.buses.map(b => (
                    <tr key={b.bus_number}>
                      <td className="bf-bus-no">{b.bus_number}</td>
                      {b.arrivals.map((mins, i) => (
                        <td key={i}><ArrivalChip minutes={mins} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="bf-disclaimer">
                Live arrivals from LTA DataMall · refreshed on each search
              </p>
            </div>
          )
        )}

      </section>
    </main>
  );
}
