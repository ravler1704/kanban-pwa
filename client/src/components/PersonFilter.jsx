import { useState } from 'react';
import Avatar from './Avatar.jsx';
import { personLabel, personOf, useBoardPeople } from './CardPeople.jsx';
import { DialogField, FilterActions, SEARCH_FROM, SearchField, SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';

const cardsCount = (n) => {
  const one = n % 10 === 1 && n % 100 !== 11;
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20);
  return `${n} ${one ? 'карточка' : few ? 'карточки' : 'карточек'}`;
};

function PersonFilterDialog({ title, list, meId, selected, onToggle, onClear, onClose }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const found = needle
    ? list.filter(({ person: p }) => [p.name, p.email].some((t) => t?.toLowerCase().includes(needle)))
    : list;
  return (
    <Modal title={title} onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      {list.length >= SEARCH_FROM && <SearchField placeholder="Поиск участника" value={query} onChange={setQuery} />}
      {!needle && (
        <ul className="fp-list ff-group">
          <SwitchRow strong label="Все карточки" on={selected.length === 0}
            meta={selected.length ? 'Сейчас: только выбранных людей' : 'Или включите нужных людей ниже'}
            onChange={(v) => v && onClear()} />
        </ul>
      )}
      <ul className="fp-list ff-list">
        {found.map(({ person, count }) => (
          <SwitchRow key={person.id} meta={cardsCount(count)}
            label={<span className="ff-person"><Avatar user={person} size={22} />{personLabel(person, meId)}</span>}
            on={selected.includes(person.id)} onChange={() => onToggle(person.id)} />
        ))}
        {found.length === 0 && <li className="fp-empty">Никого не найдено</li>}
      </ul>
      <FilterActions onClose={onClose} />
    </Modal>
  );
}

/**
 * Cards of the chosen people: `counts` maps user ids to their cards in view; `selected` are the chosen
 * user ids (none: all cards).
 */
export default function PersonFilter({ label, title, counts, selected, onToggle, onClear }) {
  const { people, meId } = useBoardPeople();
  const ids = [...new Set([...counts.keys(), ...selected])];
  const list = ids
    .map((id) => ({ person: personOf(people, id), count: counts.get(id) ?? 0 }))
    .sort((a, b) => (b.person.id === meId) - (a.person.id === meId)
      || personLabel(a.person, meId).localeCompare(personLabel(b.person, meId), 'ru'));
  const value = selected.length
    ? selected.map((id) => personLabel(personOf(people, id), meId)).join(', ')
    : 'Все карточки';
  return (
    <DialogField label={label} value={value}
      dialog={(onClose) => (
        <PersonFilterDialog title={title} list={list} meId={meId} selected={selected}
          onToggle={onToggle} onClear={onClear} onClose={onClose} />
      )} />
  );
}
