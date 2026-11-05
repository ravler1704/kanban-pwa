import { useState } from 'react';
import { DialogField, FilterActions, FilterSheet, SEARCH_FROM, SearchField } from './FolderFilter.jsx';

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
);

/** «Фильмы, Субару и ещё 2» */
function names(list) {
  const shown = list.slice(0, 3).join(', ');
  return list.length > 3 ? `${shown} и ещё ${list.length - 3}` : shown;
}

function ColumnSetDialog({ columnSets, value, onChange, onClose }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const found = needle
    ? columnSets.filter((s) => [s.name, ...s.columns, ...s.folders].some((t) => t.toLowerCase().includes(needle)))
    : columnSets;
  return (
    <FilterSheet title="Колонки" onClose={onClose}>
      <p className="fp-hint">Доски с разными наборами колонок показываются по отдельности.</p>
      {columnSets.length >= SEARCH_FROM && (
        <SearchField placeholder="Поиск набора, колонки или доски" value={query} onChange={setQuery} />
      )}
      <ul className="fp-list ff-list">
        {found.length === 0 && <li className="fp-empty">Ничего не найдено</li>}
        {found.map((s) => {
          const chosen = s.id === value;
          return (
            <li key={s.id} className={`fp-row ${chosen ? 'fp-row-selected' : ''}`}>
              <button type="button" className="fp-pick" onClick={() => {
                onChange(s.id);
                onClose();
              }}>
                <span className="fp-text">
                  <span className="fp-name">{s.name}</span>
                  <span className="fp-meta">{s.columns.join(' · ')}</span>
                  {s.folders.length > 0 && <span className="fp-meta">Доски: {names(s.folders)}</span>}
                </span>
                {chosen && <span className="fp-check"><CheckIcon /></span>}
              </button>
            </li>
          );
        })}
      </ul>
      <FilterActions onClose={onClose} />
    </FilterSheet>
  );
}

/**
 * Which column set the board shows. `columnSets` are { id, name, columns: [name], folders: [name] }
 * (the folders in view that use it).
 */
export default function ColumnSetFilter({ columnSets, value, onChange }) {
  return (
    <DialogField label="Колонки" value={columnSets.find((s) => s.id === value)?.name ?? ''}
      title="Доски с разными наборами колонок показываются по отдельности"
      dialog={(onClose) => <ColumnSetDialog columnSets={columnSets} value={value} onChange={onChange} onClose={onClose} />} />
  );
}
