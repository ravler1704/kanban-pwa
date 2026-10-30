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

/** Latest message and unread count of each project chat of the board: { [projectId]: { last, unread } }. */
export function useProjectChats() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
  const messages = useLiveQuery(() => db.comments.filter((c) => !c.cardId && !c.deleted).toArray(), []);
  const chats = {};
  for (const m of messages ?? []) {
    const chat = chats[m.projectId] ?? (chats[m.projectId] = { last: null, unread: 0 });
    if (!chat.last || m.createdAt > chat.last.createdAt) chat.last = m;
    if (isUnread(seen, m, user?.id ?? '')) chat.unread += 1;
  }
  return chats;
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

function ChatListItem({ avatar, title, last, unread, active, onClick }) {
  return (
    <button type="button" className={`chat-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      {avatar}
      <span className="chat-list-text">
        <span className="chat-list-title">
          <span className="chat-list-name">{title}</span>
          {last && <span className="chat-list-time muted">{shortTime(last.createdAt)}</span>}
        </span>
        <span className="chat-list-preview muted">{last ? preview(last.text) : 'Нет сообщений'}</span>
      </span>
      {unread > 0 && <span className="chat-unread">{unread}</span>}
    </button>
  );
}

function ProjectAvatar() {
  return <span className="avatar avatar-letter avatar-project" aria-hidden="true">#</span>;
}

/**
 * Chats: one per project of the board (`projects`) and direct messages with the people the user
 * shares projects with. `thread` is the open one: 'project:<id>' or 'dm:<user id>', '' for none.
 */
export default function ChatDialog({ projects, thread: initialThread, onClose }) {
  const [thread, setThread] = useState(initialThread || '');
  const { contacts, loaded, error } = useSyncExternalStore(dmStore.subscribe, dmStore.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const chats = useProjectChats();

  useEffect(() => {
    refreshDm();
  }, []);

  const [kind, id] = thread ? [thread.slice(0, thread.indexOf(':')), thread.slice(thread.indexOf(':') + 1)] : [];
  const project = kind === 'project' ? projects.find((p) => p.id === id) : null;
  const peer = kind === 'dm' ? contacts.find((c) => c.id === id) ?? (loaded ? null : { id }) : null;
  const open = Boolean(project || peer);

  const sortedContacts = [...contacts].sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0)
    || personName(a).localeCompare(personName(b), 'ru'));

  return (
    <Modal title="Чаты" onClose={onClose} className="modal-chat" closeButton>
      <div className={`chat-dialog ${open ? 'chat-dialog-open' : ''}`}>
        <nav className="chat-list" aria-label="Чаты">
          <h4>Чаты проектов</h4>
          {projects.map((p) => (
            <ChatListItem key={p.id} avatar={<ProjectAvatar />} title={p.name}
              last={chats[p.id]?.last} unread={chats[p.id]?.unread ?? 0}
              active={project?.id === p.id} onClick={() => setThread(`project:${p.id}`)} />
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
                {project
                  ? <><ProjectAvatar /><strong>{project.name}</strong></>
                  : <><Avatar user={peer} size={28} /><strong>{personName(peer)}</strong></>}
              </header>
              {project
                ? <Comments key={project.id} projectId={project.id} className="chat-full" placeholder="Сообщение" />
                : <DmThread key={peer.id} peer={peer} />}
            </>
          ) : (
            <p className="muted chat-pane-empty">Выберите чат слева.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
