import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { authState } from '../auth.js';
import { folderIdsOf, peopleStore, personName } from '../people.js';
import Avatar from './Avatar.jsx';
import { SEARCH_FROM, SearchField } from './FolderFilter.jsx';
import Modal from './Modal.jsx';

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
);

/** People of the board, and the signed-in user even before the list is loaded. */
export function useBoardPeople() {
  const people = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const me = useSyncExternalStore(authState.subscribe, authState.get).user;
  const list = me && !people.some((p) => p.id === me.id) ? [...people, { ...me, owner: false, folders: [] }] : people;
  return { people: list, meId: me?.id ?? null };
}

/** { id, name, picture } of the user id; people no longer on the board keep a placeholder. */
export const personOf = (people, id) => people.find((p) => p.id === id) ?? { id, name: 'Бывший участник' };

/** «Я» for the signed-in user, else the name. */
export const personLabel = (person, meId) => (person.id === meId ? 'Я' : personName(person));

function PersonDialog({ title, people, meId, value, hint, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const found = needle
    ? people.filter((p) => [p.name, p.email].some((t) => t?.toLowerCase().includes(needle)))
    : people;
  return (
    <Modal title={title} onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      {hint && <p className="fp-hint">{hint}</p>}
      {people.length >= SEARCH_FROM && <SearchField placeholder="Поиск участника" value={query} onChange={setQuery} />}
      <ul className="fp-list ff-list">
        {found.length === 0 && <li className="fp-empty">Никого не найдено</li>}
        {found.map((p) => {
          const chosen = p.id === value;
          return (
            <li key={p.id} className={`fp-row ${chosen ? 'fp-row-selected' : ''}`}>
              <button type="button" className="fp-pick" onClick={() => {
                onPick(p.id);
                onClose();
              }}>
                <Avatar user={p} size={28} />
                <span className="fp-text">
                  <span className="fp-name">{personLabel(p, meId)}</span>
                  {p.id === meId ? <span className="fp-meta">{personName(p)}</span>
                    : p.email && p.name && <span className="fp-meta">{p.email}</span>}
                </span>
                {chosen && <span className="fp-check"><CheckIcon /></span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}

function PersonChip({ label, person, meId, onClick }) {
  const content = (
    <>
      <span className="cp-label">{label}</span>
      <Avatar user={person} size={18} />
      <span className="cp-name">{personLabel(person, meId)}</span>
    </>
  );
  return onClick
    ? <button type="button" className="cp-chip" aria-haspopup="dialog" onClick={onClick}>{content}</button>
    : <span className="cp-chip">{content}</span>;
}

/**
 * A quiet line of the card: its author and who has it now (`assigneeId` null: the author).
 * Without `onAuthor` / `onAssignee` it is read only. The choice is among those who see `folderId`.
 */
export default function CardPeople({ folderId, authorId, assigneeId, onAuthor, onAssignee }) {
  const { people, meId } = useBoardPeople();
  const [picking, setPicking] = useState(null);
  const sees = people.filter((p) => p.owner || p.id === meId || folderIdsOf(p).includes(folderId));
  const holderId = assigneeId || authorId;
  const options = (current) => (current && !sees.some((p) => p.id === current) ? [...sees, personOf(people, current)] : sees);
  if (!authorId && !onAuthor) return null;

  return (
    <div className="card-people">
      {authorId && (
        <PersonChip label="Автор" person={personOf(people, authorId)} meId={meId}
          onClick={onAuthor && (() => setPicking('author'))} />
      )}
      {holderId && (
        <PersonChip label="На ком" person={personOf(people, holderId)} meId={meId}
          onClick={onAssignee && (() => setPicking('assignee'))} />
      )}
      {picking && createPortal(
        picking === 'author' ? (
          <PersonDialog title="Автор" people={options(authorId)} meId={meId} value={authorId}
            onPick={onAuthor} onClose={() => setPicking(null)} />
        ) : (
          <PersonDialog title="На ком карточка" people={options(holderId)} meId={meId} value={holderId}
            hint="Кто сейчас занимается карточкой. По умолчанию — автор."
            onPick={(id) => onAssignee(id === authorId ? null : id)} onClose={() => setPicking(null)} />
        ),
        document.body,
      )}
    </div>
  );
}
