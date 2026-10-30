import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState } from '../auth.js';
import { db } from '../db.js';
import {
  deleteDm, dmStore, editDm, loadThread, markDmRead, onDmThreadChange, refreshDm, sendDm,
} from '../dm.js';
import { personName } from '../people.js';
import { isUnread, seenStore } from '../seen.js';
import { syncStatus } from '../sync.js';
import Avatar from './Avatar.jsx';
import ChatThread from './ChatThread.jsx';
import Comments from './Comments.jsx';
import Modal from './Modal.jsx';

const preview = (text) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

function shortTime(ts) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * Latest message and unread count of the board's chats: `projects` — { [projectId]: { last, unread } },
 * `cards` — [{ card, last, unread }] of the cards that have comments, the latest first.
 */
export function useChats() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
  const data = useLiveQuery(async () => {
    const messages = await db.comments.filter((c) => !c.deleted).toArray();
    const cardIds = [...new Set(messages.filter((m) => m.cardId).map((m) => m.cardId))];
    const cards = (await db.cards.bulkGet(cardIds)).filter((c) => c && !c.deleted);
    return { messages, cards };
  }, []);
  const projects = {};
  const byCard = new Map((data?.cards ?? []).map((card) => [card.id, { card, last: null, unread: 0 }]));
  for (const m of data?.messages ?? []) {
    const chat = m.cardId ? byCard.get(m.cardId) : (projects[m.projectId] ??= { last: null, unread: 0 });
    if (!chat) continue;
    if (!chat.last || m.createdAt > chat.last.createdAt) chat.last = m;
    if (isUnread(seen, m, user?.id ?? '')) chat.unread += 1;
  }
  const cards = [...byCard.values()].sort((a, b) => b.last.createdAt - a.last.createdAt);
  return { projects, cards };
}

function DmThread({ peer }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [thread, setThread] = useState(null);
  const [error, setError] = useState(null);
  const me = user?.id ?? '';

  const load = useCallback(async () => {
    try {
      const next = await loadThread(peer.id);
      setThread(next);
      setError(null);
      const theirs = next.messages.filter((m) => m.sender === peer.id);
      if (theirs.length) markDmRead(peer.id, theirs[theirs.length - 1].createdAt);
    } catch (err) {
      setError(err.message);
    }
  }, [peer.id]);

  useEffect(() => {
    load();
    return onDmThreadChange((changed) => {
      if (changed === undefined || changed === peer.id) load();
    });
  }, [load, peer.id]);

  const profile = thread?.peer ?? peer;
  const messages = (thread?.messages ?? []).filter((m) => !m.deleted).map((m) => ({
    ...m,
    authorId: m.sender,
    authorName: m.sender === me ? personName(user) : personName(profile),
    authorPicture: m.sender === me ? user?.picture : profile.picture,
  }));

  let hint = error;
  if (!online) hint = 'Личные сообщения доступны только при подключении к интернету.';
  else if (thread && !thread.canWrite) hint = 'Общих проектов больше нет — написать нельзя.';

  return (
    <ChatThread
      className="chat-full"
      messages={messages}
      me={me}
      empty={thread ? 'Сообщений пока нет — напишите первым.' : 'Загрузка…'}
      hint={hint}
      disabled={!online || !thread?.canWrite}
      onSend={(text) => sendDm(peer.id, text)}
      onEdit={(m, text) => editDm(peer.id, m.id, text)}
      onDelete={(m) => deleteDm(peer.id, m.id)}
    />
  );
}

function ChatListItem({ avatar, title, subtitle, last, unread, active, onClick }) {
  return (
    <button type="button" className={`chat-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      {avatar}
      <span className="chat-list-text">
        <span className="chat-list-title">
          <span className="chat-list-name">{title}</span>
          {last && <span className="chat-list-time muted">{shortTime(last.createdAt)}</span>}
        </span>
        {subtitle && <span className="chat-list-subtitle muted">{subtitle}</span>}
        <span className="chat-list-preview muted">{last ? preview(last.text) : 'Нет сообщений'}</span>
      </span>
      {unread > 0 && <span className="chat-unread">{unread}</span>}
    </button>
  );
}

function ProjectAvatar() {
  return <span className="avatar avatar-letter avatar-project" aria-hidden="true">#</span>;
}

function CardAvatar() {
  return (
    <span className="avatar avatar-letter avatar-project" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    </span>
  );
}

const cardTitle = (card) => card.title.trim() || 'Без названия';

/**
 * Chats: one per project of the board (`projects`), those of the cards with comments and direct
 * messages with the people the user shares projects with. `thread` is the open one: 'project:<id>',
 * 'card:<id>' or 'dm:<user id>', '' for none. `onOpenCard(id)` opens a card's editor.
 */
export default function ChatDialog({ projects, thread: initialThread, onOpenCard, onClose }) {
  const [thread, setThread] = useState(initialThread || '');
  const { contacts, loaded, error } = useSyncExternalStore(dmStore.subscribe, dmStore.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const chats = useChats();

  useEffect(() => {
    refreshDm();
  }, []);

  const [kind, id] = thread ? [thread.slice(0, thread.indexOf(':')), thread.slice(thread.indexOf(':') + 1)] : [];
  const project = kind === 'project' ? projects.find((p) => p.id === id) : null;
  const threadCard = useLiveQuery(() => (kind === 'card' ? db.cards.get(id) : null), [kind, id]);
  const card = threadCard && !threadCard.deleted && projects.some((p) => p.id === threadCard.projectId)
    ? threadCard : null;
  const peer = kind === 'dm' ? contacts.find((c) => c.id === id) ?? (loaded ? null : { id }) : null;
  const open = Boolean(project || card || peer);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const cardChats = chats.cards.filter((c) => projectName.has(c.card.projectId));

  const sortedContacts = [...contacts].sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0)
    || personName(a).localeCompare(personName(b), 'ru'));

  return (
    <Modal title="Чаты" onClose={onClose} className="modal-chat" closeButton>
      <div className={`chat-dialog ${open ? 'chat-dialog-open' : ''}`}>
        <nav className="chat-list" aria-label="Чаты">
          <h4>Чаты проектов</h4>
          {projects.map((p) => (
            <ChatListItem key={p.id} avatar={<ProjectAvatar />} title={p.name}
              last={chats.projects[p.id]?.last} unread={chats.projects[p.id]?.unread ?? 0}
              active={project?.id === p.id} onClick={() => setThread(`project:${p.id}`)} />
          ))}
          <h4>Чаты карточек</h4>
          {cardChats.length === 0 && (
            <p className="muted chat-list-note">Комментариев к карточкам пока нет.</p>
          )}
          {cardChats.map((c) => (
            <ChatListItem key={c.card.id} avatar={<CardAvatar />} title={cardTitle(c.card)}
              subtitle={projects.length > 1 ? projectName.get(c.card.projectId) : null}
              last={c.last} unread={c.unread}
              active={card?.id === c.card.id} onClick={() => setThread(`card:${c.card.id}`)} />
          ))}
          <h4>Личные сообщения</h4>
          {!online && <p className="muted chat-list-note">Нет подключения к интернету.</p>}
          {online && error && <p className="muted chat-list-note">{error}</p>}
          {online && loaded && contacts.length === 0 && (
            <p className="muted chat-list-note">Пока не с кем: пригласите людей в проект или примите приглашение.</p>
          )}
          {sortedContacts.map((c) => (
            <ChatListItem key={c.id} avatar={<Avatar user={c} size={36} />} title={personName(c)}
              last={c.last && !c.last.deleted ? c.last : null} unread={c.unread}
              active={peer?.id === c.id} onClick={() => setThread(`dm:${c.id}`)} />
          ))}
        </nav>
        <section className="chat-pane">
          {open ? (
            <>
              <header className="chat-pane-head">
                <button type="button" className="btn btn-small chat-back" onClick={() => setThread('')}
                  aria-label="К списку чатов">←</button>
                {project && <><ProjectAvatar /><strong>{project.name}</strong></>}
                {card && (
                  <>
                    <CardAvatar />
                    <strong className="chat-pane-title">{cardTitle(card)}</strong>
                    <button type="button" className="btn btn-small chat-open-card" onClick={() => onOpenCard(card.id)}>
                      Открыть карточку
                    </button>
                  </>
                )}
                {peer && <><Avatar user={peer} size={28} /><strong>{personName(peer)}</strong></>}
              </header>
              {project && <Comments key={project.id} projectId={project.id} className="chat-full" placeholder="Сообщение" />}
              {card && <Comments key={card.id} card={card} className="chat-full" />}
              {peer && <DmThread key={peer.id} peer={peer} />}
            </>
          ) : (
            <p className="muted chat-pane-empty">Выберите чат слева.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
