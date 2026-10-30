import { useEffect, useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { dmStore, dmUnread, refreshDm } from '../dm.js';
import { peopleStore, personName } from '../people.js';
import Avatar from './Avatar.jsx';
import { CommentIcon } from './Card.jsx';
import { useChats } from './ChatDialog.jsx';
import Modal from './Modal.jsx';

const STACK = 4;

function PeopleDialog({ people, projects, allProjects, me, onChat, onClose }) {
  const projectName = new Map(allProjects.map((p) => [p.id, p.name]));
  return (
    <Modal title="Участники" onClose={onClose}>
      <div className="people-chats">
        {projects.map((p) => (
          <button key={p.id} type="button" className="btn btn-small" onClick={() => onChat(`project:${p.id}`)}>
            <CommentIcon size={14} /> Чат проекта «{p.name}»
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
                {p.owner ? 'Владелец доски' : p.projects.map((id) => projectName.get(id)).filter(Boolean).join(', ')}
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
 * The chats button with the number of unread messages (direct ones and the chats of `projects`);
 * shown when the board is shared or there is someone to write to.
 */
export function ChatButton({ projects, onChat }) {
  const all = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const { contacts } = useSyncExternalStore(dmStore.subscribe, dmStore.get);
  const chats = useChats();

  useEffect(() => {
    refreshDm();
  }, []);

  if (all.length < 2 && contacts.length === 0) return null;
  const shown = new Set(projects.map((p) => p.id));
  const unread = dmUnread(contacts)
    + projects.reduce((sum, p) => sum + (chats.projects[p.id]?.unread ?? 0), 0)
    + chats.cards.reduce((sum, c) => sum + (shown.has(c.card.projectId) ? c.unread : 0), 0);
  return (
    <button type="button" className="btn btn-small btn-icon-only chat-button" onClick={() => onChat('')}
      title={unread ? `Чаты: непрочитанных ${unread}` : 'Чаты'} aria-label="Чаты">
      <CommentIcon size={18} />
      {unread > 0 && <span className="chat-unread chat-unread-dot">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

/**
 * Avatars of the people who see the shown `projects` (the board's owner sees all of them).
 * `onChat(thread)` opens the chats.
 */
export default function PeopleBar({ projects, allProjects, onChat }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const all = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const [open, setOpen] = useState(false);
  const me = user?.id ?? '';

  const shown = new Set(projects.map((p) => p.id));
  const people = all
    .filter((p) => p.owner || p.projects.some((id) => shown.has(id)))
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
        <PeopleDialog people={people} projects={projects} allProjects={allProjects} me={me}
          onClose={() => setOpen(false)}
          onChat={(thread) => {
            setOpen(false);
            onChat(thread);
          }} />
      )}
    </div>
  );
}
