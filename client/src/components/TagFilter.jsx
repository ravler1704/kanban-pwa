import { useState } from 'react';
import { DialogField, SEARCH_FROM, SearchField, SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';

const cardsCount = (n) => {
  const one = n % 10 === 1 && n % 100 !== 11;
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20);
  return `${n} ${one ? 'карточка' : few ? 'карточки' : 'карточек'}`;
};

/** Switches of the tags; changes apply at once. */
function TagFilterDialog({ tags, selected, onToggle, onClear, onClose }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().replace(/^#+/, '').toLowerCase();
  const found = needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : tags;

  return (
    <Modal title="Теги" onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      {tags.length >= SEARCH_FROM && <SearchField placeholder="Поиск тега" value={query} onChange={setQuery} />}
      {!needle && tags.length > 0 && (
        <ul className="fp-list ff-group">
          <SwitchRow strong label="Все карточки" on={selected.length === 0}
            meta={selected.length ? 'Сейчас: только с выбранными тегами' : 'Или включите нужные теги ниже'}
            onChange={(v) => v && onClear()} />
        </ul>
      )}
      <ul className="fp-list ff-list">
        {found.map((t) => (
          <SwitchRow key={t.key} label={`#${t.name}`} meta={t.count != null ? cardsCount(t.count) : null}
            on={selected.includes(t.key)} onChange={() => onToggle(t.key)} />
        ))}
        {found.length === 0 && <li className="fp-empty">{needle ? 'Тегов не найдено' : 'У карточек пока нет тегов'}</li>}
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

/**
 * Tags to filter cards by: a card is shown when it has any of the `selected` tag keys.
 * `tags` ({ key, name, count }) are the tags of the cards in view and the selected ones.
 */
export default function TagFilter({ tags, selected, onToggle, onClear }) {
  const nameOf = (key) => `#${tags.find((t) => t.key === key)?.name ?? key}`;
  return (
    <DialogField label="Теги" value={selected.length ? selected.map(nameOf).join(', ') : 'Все карточки'}
      dialog={(onClose) => (
        <TagFilterDialog tags={tags} selected={selected} onToggle={onToggle} onClear={onClear} onClose={onClose} />
      )} />
  );
}
