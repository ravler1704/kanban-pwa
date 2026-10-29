import { useEffect, useRef, useState } from 'react';

function ClearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Picker of the tags to filter cards by: a card is shown when it has any of the `selected` tag keys.
 * `tags` ({ key, name, count }) are the tags of the cards in view and the selected ones.
 */
export default function TagFilter({ tags, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nameOf = (key) => tags.find((t) => t.key === key)?.name ?? key;
  const active = selected.length > 0;
  const query = search.trim().replace(/^#+/, '').toLowerCase();
  const found = query ? tags.filter((t) => t.key.includes(query)) : tags;

  function toggleOpen() {
    setSearch('');
    setOpen(!open);
  }

  return (
    <div className="picker tag-filter" ref={root}>
      <span className="picker-label">Теги</span>
      <button type="button" className={`select ${active ? '' : 'select-empty'}`} aria-expanded={open}
        onClick={toggleOpen}>
        {active ? selected.map((key) => `#${nameOf(key)}`).join(', ') : 'Все'}
      </button>
      {active && (
        <button className="btn-clear" title="Показать все карточки" aria-label="Сбросить теги"
          onClick={onClear}><ClearIcon /></button>
      )}
      {open && (
        <div className="tag-menu">
          <input className="tag-search" type="search" placeholder="Поиск тега" autoFocus
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !found.length) return;
              e.preventDefault();
              onToggle(found[0].key);
              setSearch('');
            }} />
          {found.length === 0 && <p className="tag-menu-empty">Тегов не найдено</p>}
          {found.map((t) => (
            <label key={t.key} className="tag-menu-item">
              <input type="checkbox" checked={selected.includes(t.key)} onChange={() => onToggle(t.key)} />
              <span className="tag-menu-name">#{t.name}</span>
              <span className="count">{t.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
