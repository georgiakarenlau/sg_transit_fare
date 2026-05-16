/**
 * LocationInput — a text input with live autocomplete from the OneMap search API.
 *
 * Props:
 *   id          {string}   — <label for> / <input id>
 *   label       {string}   — label text above the input
 *   placeholder {string}   — placeholder text
 *   value       {string}   — controlled value
 *   onChange    {function} — called with a plain string (not an event) on change
 */

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEBOUNCE_MS = 300;   // wait after last keystroke before fetching

export default function LocationInput({ id, label, placeholder, value, onChange }) {
  const [suggestions, setSuggestions]       = useState([]);
  const [showDropdown, setShowDropdown]     = useState(false);
  const [activeSuggestion, setActive]       = useState(-1);  // keyboard nav index
  const wrapperRef  = useRef(null);
  const debounceRef = useRef(null);

  // ── Fetch suggestions (debounced) ────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/api/search`, {
          params: { q: value.trim() },
        });
        setSuggestions(data);
        setShowDropdown(data.length > 0);
        setActive(-1);
      } catch {
        setSuggestions([]);
        setShowDropdown(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // ── Close dropdown when user clicks outside ───────────────────────────────────
  useEffect(() => {
    function onClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // ── Select a suggestion ───────────────────────────────────────────────────────
  function select(suggestion) {
    onChange(suggestion.name);
    setShowDropdown(false);
    setSuggestions([]);
    setActive(-1);
  }

  // ── Keyboard navigation (↑ ↓ Enter Escape) ───────────────────────────────────
  function onKeyDown(e) {
    if (!showDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      select(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="input-group" ref={wrapperRef}>
      <label htmlFor={id}>{label}</label>

      <div className="autocomplete-wrapper">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={e => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          onKeyDown={onKeyDown}
        />

        {showDropdown && (
          <ul className="suggestion-list" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={i}
                role="option"
                aria-selected={i === activeSuggestion}
                className={`suggestion-item${i === activeSuggestion ? ' active' : ''}`}
                // onMouseDown fires before onBlur, so the click is registered
                // before the dropdown closes.
                onMouseDown={() => select(s)}
              >
                <span className="suggestion-name">{s.name}</span>
                {s.address && (
                  <span className="suggestion-address">{s.address}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
