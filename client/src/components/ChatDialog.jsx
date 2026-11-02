import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState } from '../auth.js';
import { messageText, useCardNumbers } from '../chatEvents.jsx';
import { db } from '../db.js';
import { folderPath } from '../folders.js';
import { withoutLinks } from '../links.js';
import {
  deleteDm, dmStore, editDm, loadThread, markDmRead, onDmThreadChange, refreshDm, sendDm,
} from '../dm.js';
import { peopleStore, personName, refreshPeople } from '../people.js';
import { isUnread, seenStore } from '../seen.js';
import { syncStatus } from '../sync.js';
import Avatar from './Avatar.jsx';
import ChatThread from './ChatThread.jsx';
import Comments, { HistoryToggle } from './Comments.jsx';
import Modal from './Modal.jsx';

const preview = (text) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

function shortTime(ts) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Chats of folders keep their ids from when they were projects and spaces: 'project:<id>' is 'folder:<id>'. */
export const normalizeThread = (thread) => (thread ? thread.replace(/^(?:project|space):/, 'folder:') : '');

/**
 * Latest message and unread count of the board's chats: `folders` — { [id]: { last, unread } },
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
  const folders = {};
  const byCard = new Map((data?.cards ?? []).map((card) => [card.id, { card, last: null, unread: 0 }]));
  for (const m of data?.messages ?? []) {
    const chat = m.cardId ? byCard.get(m.cardId) : (folders[m.folderId] ??= { last: null, unread: 0 });
    if (!chat) continue;
    if (!chat.last || m.createdAt > chat.last.createdAt) chat.last = m;
    if (isUnread(seen, m, user?.id ?? '')) chat.unread += 1;
  }
  const cards = [...byCard.values()].sort((a, b) => b.last.createdAt - a.last.createdAt);
  return { folders, cards };
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

function ChatListItem({ avatar, title, subtitle, last, text, unread, active, onClick }) {
  return (
    <button type="button" className={`chat-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      {avatar}
      <span className="chat-list-text">
        <span className="chat-list-title">
          <span className="chat-list-name">{title}</span>
          {last && <span className="chat-list-time muted">{shortTime(last.createdAt)}</span>}
        </span>
        {subtitle && <span className="chat-list-subtitle muted">{subtitle}</span>}
        <span className="chat-list-preview muted">{last ? preview(text) : 'Нет сообщений'}</span>
      </span>
      {unread > 0 && <span className="chat-unread">{unread}</span>}
    </button>
  );
}

function FolderAvatar() {
  return (
    <span className="avatar avatar-letter avatar-project" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    </span>
  );
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

const MEMBERS_STACK = 3;

/** Avatars of the chat's members in its header; pressing them shows or hides the list. */
function MembersButton({ people, open, onToggle }) {
  return (
    <button type="button" className={`avatar-stack chat-members-button ${open ? 'active' : ''}`} onClick={onToggle}
      aria-expanded={open} title={`Участники: ${people.map(personName).join(', ')}`}>
      {people.slice(0, MEMBERS_STACK).map((p) => <Avatar key={p.id} user={p} size={24} />)}
      {people.length > MEMBERS_STACK && <span className="avatar avatar-letter avatar-more">+{people.length - MEMBERS_STACK}</span>}
      <span className="chat-members-count">{people.length}</span>
    </button>
  );
}

function MembersList({ people, me, onWrite }) {
  return (
    <ul className="people-list chat-members">
      {people.map((p) => (
        <li key={p.id} className="people-item">
          <Avatar user={p} size={36} />
          <div className="people-info">
            <div className="people-name">{personName(p)}{p.id === me && <span className="muted"> (вы)</span>}</div>
            <div className="muted people-role">{p.owner ? 'Владелец доски' : p.email}</div>
          </div>
          {p.id !== me && <button type="button" className="btn btn-small" onClick={() => onWrite(p)}>Написать</button>}
        </li>
      ))}
    </ul>
  );
}

const byRole = (a, b) => Number(b.owner) - Number(a.owner) || personName(a).localeCompare(personName(b), 'ru');

const cardTitle = (card) => `${card.number ? `#${card.number} ` : ''}${withoutLinks(card.title).trim() || 'Без названия'}`;

/**
 * Chats: one per folder of the board (`folders`), those of the cards with comments and direct messages
 * with the people the user shares folders with. `thread` is the open one: 'folder:<id>', 'card:<id>' or
 * 'dm:<user id>', '' for none. `onOpenCard(id)` opens a card's editor.
 */
export default function ChatDialog({ folders, thread: initialThread, onOpenCard, onClose }) {
  const [thread, setThread] = useState(normalizeThread(initialThread));
  const [search, setSearch] = useState('');
  const { contacts, loaded } = useSyncExternalStore(dmStore.subscribe, dmStore.get);
  const chats = useChats();
  const numbers = useCardNumbers();
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const everyone = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    refreshDm();
    refreshPeople();
  }, []);

  const [kind, id] = thread ? [thread.slice(0, thread.indexOf(':')), thread.slice(thread.indexOf(':') + 1)] : [];
  const folder = kind === 'folder' ? folders.find((f) => f.id === id) : null;
  const threadCard = useLiveQuery(() => (kind === 'card' ? db.cards.get(id) : null), [kind, id]);
  const card = threadCard && !threadCard.deleted && folders.some((f) => f.id === threadCard.folderId)
    ? threadCard : null;
  const peer = kind === 'dm' ? contacts.find((c) => c.id === id) ?? (loaded ? null : { id }) : null;
  const open = Boolean(folder || card || peer);
  // Who is in a folder's chat: the owner and those with access to it.
  const members = folder
    ? everyone.filter((p) => p.owner || (p.folders ?? [...(p.projects ?? []), ...(p.spaces ?? [])]).includes(folder.id)).sort(byRole)
    : [];
  const membersShown = showMembers && members.length > 0;
  const openThread = (next) => {
    setThread(next);
    setShowMembers(false);
  };
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  // «Работа / Проект» for a folder below the top level.
  const parentName = (f) => {
    const path = folderPath(f, folders);
    return path.length > 1 ? path.slice(0, -1).map((p) => p.name).join(' / ') : null;
  };

  // All chats in one list: the latest message first, those without messages after them.
  const items = [
    ...folders.map((f) => ({
      thread: `folder:${f.id}`, avatar: <FolderAvatar />, title: f.name, subtitle: parentName(f),
      last: chats.folders[f.id]?.last ?? null, unread: chats.folders[f.id]?.unread ?? 0,
    })),
    ...chats.cards.filter((c) => folderName.has(c.card.folderId)).map((c) => ({
      thread: `card:${c.card.id}`, avatar: <CardAvatar />, title: cardTitle(c.card),
      subtitle: folders.length > 1 ? folderName.get(c.card.folderId) : null,
      last: c.last, unread: c.unread,
    })),
    ...contacts.map((c) => ({
      thread: `dm:${c.id}`, avatar: <Avatar user={c} size={36} />, title: personName(c),
      last: c.last && !c.last.deleted ? c.last : null, unread: c.unread,
    })),
  ].sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0) || a.title.localeCompare(b.title, 'ru'));
  const query = search.trim().toLocaleLowerCase('ru');
  const found = query
    ? items.filter((i) => [i.title, i.subtitle, i.last && messageText(i.last, numbers)]
      .some((text) => text?.toLocaleLowerCase('ru').includes(query)))
    : items;

  return (
    <Modal title="Чаты" onClose={onClose} className="modal-chat" closeButton>
      <div className={`chat-dialog ${open ? 'chat-dialog-open' : ''}`}>
        <nav className="chat-side" aria-label="Чаты">
          <input className="check-search chat-search" type="search" placeholder="Поиск по чатам"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chat-list">
            {found.map((i) => (
              <ChatListItem key={i.thread} avatar={i.avatar} title={i.title} subtitle={i.subtitle}
                text={i.last && messageText(i.last, numbers)}
                last={i.last} unread={i.unread} active={thread === i.thread} onClick={() => openThread(i.thread)} />
            ))}
            {query && found.length === 0 && <p className="muted chat-list-note">Ничего не найдено.</p>}
          </div>
        </nav>
        <section className="chat-pane">
          {open ? (
            <>
              <header className="chat-pane-head">
                <button type="button" className="btn btn-small chat-back" onClick={() => openThread('')}
                  aria-label="К списку чатов">←</button>
                {folder && <><FolderAvatar /><strong className="chat-pane-title">{folder.name}</strong></>}
                {members.length > 0 && (
                  <MembersButton people={members} open={membersShown} onToggle={() => setShowMembers(!showMembers)} />
                )}
                {card && (
                  <>
                    <CardAvatar />
                    <strong className="chat-pane-title">{cardTitle(card)}</strong>
                    <span className="chat-pane-actions">
                      <HistoryToggle />
                      <button type="button" className="btn btn-small" onClick={() => onOpenCard(card.id)}>
                        Открыть карточку
                      </button>
                    </span>
                  </>
                )}
                {peer && <><Avatar user={peer} size={28} /><strong>{personName(peer)}</strong></>}
              </header>
              {membersShown && (
                <MembersList people={members} me={user?.id ?? ''} onWrite={(p) => openThread(`dm:${p.id}`)} />
              )}
              {folder && !membersShown && (
                <Comments key={folder.id} folderId={folder.id} className="chat-full" placeholder="Сообщение"
                  onOpenCard={onOpenCard} />
              )}
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
