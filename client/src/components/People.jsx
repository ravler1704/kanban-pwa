import { useEffect, useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { dmStore, dmUnread, refreshDm } from '../dm.js';
import { folderIdsOf, peopleStore, personName } from '../people.js';
import { topFolderIds } from '../folders.js';
import Avatar from './Avatar.jsx';
import { CommentIcon } from './Card.jsx';
import { useChats } from './ChatDialog.jsx';
import Modal from './Modal.jsx';

const STACK = 4;

/** The shown folders whose parent is not shown: their chats stand for the whole selection. */
const topFolders = (folders, allFolders) => {
  const tops = new Set(topFolderIds(folders.map((f) => f.id), allFolders));
  return folders.filter((f) => tops.has(f.id));
};

function PeopleDialog({ people, folders, allFolders, me, onChat, onClose }) {
  const folderName = new Map(allFolders.map((f) => [f.id, f.name]));
  // Where a person has access: the top folders of their access, as the rest follows from them.
  const accessOf = (p) => topFolderIds(folderIdsOf(p), allFolders).map((id) => folderName.get(id)).filter(Boolean);
  return (
    <Modal title="Участники" onClose={onClose}>
      <div className="people-chats">
        {folders.map((f) => (
          <button key={f.id} type="button" className="btn btn-small" onClick={() => onChat(`folder:${f.id}`)}>
            <CommentIcon size={14} /> Чат доски «{f.name}»
          </button>
        ))}
      </div>
      <ul className="people-list">
        {people.map((p) => (
          <li key={p.id} className="people-item">
            <Avatar user={p} size={40} />
            <div className="people-info">
              <div className="people-name">{personName(p)}{p.id === me && <span className="muted"> (вы)</span>}</div>
              {p.email && p.name && <div className="muted people-email">{p.email}</div>}
              <div className="muted people-role">
                {p.owner ? 'Владелец пространства' : accessOf(p).join(', ')}
              </div>
            </div>
            {p.id !== me && (
              <button type="button" className="btn btn-small" onClick={() => onChat(`dm:${p.id}`)}>Написать</button>
            )}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </div>
    </Modal>
  );
}

/**
 * The chats button with the number of unread messages (direct ones and the chats of `folders`
 * and of the cards in them).
 */
export function ChatButton({ folders, onChat }) {
  const { contacts } = useSyncExternalStore(dmStore.subscribe, dmStore.get);
  const chats = useChats();

  useEffect(() => {
    refreshDm();
  }, []);

  const shown = new Set(folders.map((f) => f.id));
  const unread = dmUnread(contacts)
    + folders.reduce((sum, f) => sum + (chats.folders[f.id]?.unread ?? 0), 0)
    + chats.cards.reduce((sum, c) => sum + (shown.has(c.card.folderId) ? c.unread : 0), 0);
  return (
    <button type="button" className="btn btn-small btn-icon-only chat-button" onClick={() => onChat('')}
      title={unread ? `Чаты: непрочитанных ${unread}` : 'Чаты'} aria-label="Чаты">
      <CommentIcon size={18} />
      {unread > 0 && <span className="chat-unread chat-unread-dot">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

/**
 * Avatars of the people who see the shown `folders` (the board's owner sees all of them);
 * `allFolders` are all the folders of the board. `onChat(thread)` opens the chats.
 */
export default function PeopleBar({ folders, allFolders, onChat }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const all = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const [open, setOpen] = useState(false);
  const me = user?.id ?? '';

  const shown = new Set(folders.map((f) => f.id));
  const people = all
    .filter((p) => p.owner || folderIdsOf(p).some((id) => shown.has(id)))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || personName(a).localeCompare(personName(b), 'ru'));
  if (people.length < 2) return null;

  return (
    <div className="people-bar">
      <button type="button" className="avatar-stack" onClick={() => setOpen(true)}
        title={`Участники: ${people.map(personName).join(', ')}`} aria-label="Участники">
        {people.slice(0, STACK).map((p) => <Avatar key={p.id} user={p} size={28} />)}
        {people.length > STACK && <span className="avatar avatar-letter avatar-more">+{people.length - STACK}</span>}
      </button>
      {open && (
        <PeopleDialog people={people} folders={topFolders(folders, allFolders)} allFolders={allFolders} me={me}
          onClose={() => setOpen(false)}
          onChat={(thread) => {
            setOpen(false);
            onChat(thread);
          }} />
      )}
    </div>
  );
}
