import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { cardColor, folderBackground } from '../appearance.js';
import { authState } from '../auth.js';
import { messageText, useCardNumbers } from '../chatEvents.jsx';
import { db } from '../db.js';
import { folderPath } from '../folders.js';
import { withoutLinks } from '../links.js';
import {
  clearDm, deleteDm, dmStore, editDm, loadThread, markDmRead, onDmThreadChange, refreshDm, sendDm,
} from '../dm.js';
import { peopleStore, personName, refreshPeople } from '../people.js';
import { isUnread, seenStore } from '../seen.js';
import {
  deleteSupport, editSupport, loadSupportThread, markSupportRead, onSupportThreadChange, refreshSupport, sendSupport,
  setSupportStatus, supportStore,
} from '../support.js';
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
      direct
      messages={messages}
      me={me}
      empty={thread ? 'Сообщений пока нет — напишите первым.' : 'Загрузка…'}
      hint={hint}
      disabled={!online || !thread?.canWrite}
      onSend={(text, images) => sendDm(peer.id, text, images)}
      onEdit={(m, text) => editDm(peer.id, m.id, text)}
      onDelete={(m) => deleteDm(peer.id, m.id)}
    />
  );
}

const SUPPORT_NAME = 'Техподдержка';

/** The conversation with the support: the user's own (`user` 'me') or, for an administrator, a user's. */
function SupportThread({ user: ticketUser }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [thread, setThread] = useState(null);
  const [error, setError] = useState(null);
  const me = user?.id ?? '';
  const asSupport = ticketUser !== 'me';

  const load = useCallback(async () => {
    try {
      const next = await loadSupportThread(ticketUser);
      setThread(next);
      setError(null);
      // The other side's messages: the support's for the user, the user's for the administrators.
      const theirs = next.messages.filter((m) => m.fromSupport !== asSupport);
      if (theirs.length) markSupportRead(ticketUser, theirs[theirs.length - 1].createdAt);
    } catch (err) {
      setError(err.message);
    }
  }, [ticketUser, asSupport]);

  useEffect(() => {
    load();
    return onSupportThreadChange((changed) => {
      if (changed === undefined || changed === ticketUser || (!asSupport && changed === 'me')) load();
    });
  }, [load, ticketUser, asSupport]);

  const messages = (thread?.messages ?? []).filter((m) => !m.deleted).map((m) => {
    const author = thread.authors[m.author] ?? {};
    return {
      ...m,
      authorId: m.author,
      authorName: m.fromSupport ? `${SUPPORT_NAME}${author.name ? ` · ${author.name}` : ''}` : personName(thread.user),
      authorPicture: author.picture,
    };
  });

  let hint = error;
  if (!online) hint = 'Техподдержка доступна только при подключении к интернету.';
  else if (!asSupport && thread?.status === 'solved') hint = 'Обращение решено. Напишите, если вопрос остался, — оно откроется снова.';

  return (
    <ChatThread
      className="chat-full"
      messages={messages}
      me={me}
      empty={thread
        ? (asSupport ? 'Сообщений нет.' : 'Опишите вопрос или проблему — администраторы ответят здесь же.')
        : 'Загрузка…'}
      hint={hint}
      placeholder={asSupport ? 'Ответ пользователю' : 'Сообщение в техподдержку'}
      disabled={!online || !thread}
      onSend={(text, images) => sendSupport(ticketUser, text, images)}
      onEdit={(m, text) => editSupport(ticketUser, m.id, text)}
      onDelete={(m) => deleteSupport(ticketUser, m.id)}
    />
  );
}

function DeleteDmDialog({ peer, onDone, onClose }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [forBoth, setForBoth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = personName(peer);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await clearDm(peer.id, forBoth);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Удалить чат" onClose={onClose} className="delete-dm-dialog">
      <p>Удалить всю переписку в чате «{name}»? Это нельзя отменить.</p>
      <label className="delete-dm-both">
        <input type="checkbox" checked={forBoth} onChange={(e) => setForBoth(e.target.checked)} />
        Удалить и у собеседника
      </label>
      <p className="muted delete-dm-hint">
        {forBoth ? 'Переписка исчезнет у обоих.' : 'Переписка исчезнет только у вас, у собеседника она останется.'}
      </p>
      {!online && <p className="muted">Удалить чат можно только при подключении к интернету.</p>}
      {error && <p className="login-error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-danger" disabled={busy || !online} onClick={submit}>Удалить</button>
      </div>
    </Modal>
  );
}

function ChatListItem({ avatar, title, subtitle, last, text, unread, active, onClick, placeholder = 'Нет сообщений' }) {
  return (
    <button type="button" className={`chat-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      {avatar}
      <span className="chat-list-text">
        <span className="chat-list-title">
          <span className="chat-list-name">{title}</span>
          {last && <span className="chat-list-time muted">{shortTime(last.createdAt)}</span>}
        </span>
        {subtitle && <span className="chat-list-subtitle muted">{subtitle}</span>}
        <span className="chat-list-preview muted">{last ? preview(text) : placeholder}</span>
      </span>
      {unread > 0 && <span className="chat-unread">{unread}</span>}
    </button>
  );
}

/**
 * The avatar of a folder's or card's chat: the board's background or the card's cover (`background`),
 * else a colour fixed by `seed`.
 */
function ChatIcon({ seed = '', background, size = 46, children }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return (
    <span className="avatar avatar-letter avatar-chat" aria-hidden="true"
      style={{ width: size, height: size, '--chat-hue': hash, ...(background && { '--chat-icon': background }) }}>
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </span>
  );
}

const FolderAvatar = ({ id, background, size }) => (
  <ChatIcon seed={id} background={background} size={size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </ChatIcon>
);

const CardAvatar = ({ id, background, size }) => (
  <ChatIcon seed={id} background={background} size={size}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h5" />
  </ChatIcon>
);

const SupportAvatar = ({ size }) => (
  <ChatIcon seed="support" size={size}>
    <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
    <path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2ZM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2Z" />
    <path d="M18 17v1a3 3 0 0 1-3 3h-3" />
  </ChatIcon>
);

const STATUS_LABEL = { open: 'Открыто', solved: 'Решено' };

function plural(n, one, few, many) {
  const tens = n % 100;
  const units = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
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
            <div className="muted people-role">{p.owner ? 'Владелец пространства' : p.email}</div>
          </div>
          {p.id !== me && <button type="button" className="btn btn-small" onClick={() => onWrite(p)}>Написать</button>}
        </li>
      ))}
    </ul>
  );
}

function CloseButton({ className, onClose }) {
  return (
    <button type="button" className={`chat-head-btn ${className}`} onClick={onClose} aria-label="Закрыть" title="Закрыть">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
        strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
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
  const [deletingDm, setDeletingDm] = useState(false);
  const support = useSyncExternalStore(supportStore.subscribe, supportStore.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    refreshDm();
    refreshPeople();
    refreshSupport();
  }, []);

  const [kind, id] = thread ? [thread.slice(0, thread.indexOf(':')), thread.slice(thread.indexOf(':') + 1)] : [];
  const folder = kind === 'folder' ? folders.find((f) => f.id === id) : null;
  const threadCard = useLiveQuery(() => (kind === 'card' ? db.cards.get(id) : null), [kind, id]);
  const card = threadCard && !threadCard.deleted && folders.some((f) => f.id === threadCard.folderId)
    ? threadCard : null;
  const peer = kind === 'dm' ? contacts.find((c) => c.id === id) ?? (loaded ? null : { id }) : null;
  // The user's own conversation with the support ('support:me'), or a user's one for an administrator.
  const ownSupport = Boolean(user) && !support.admin;
  const ticket = kind === 'support' && id !== 'me' ? support.tickets?.find((t) => t.userId === id) ?? null : null;
  const supportOpen = kind === 'support' && (id === 'me' ? ownSupport : Boolean(ticket));
  const open = Boolean(folder || card || peer || supportOpen);
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
  const boardBg = folder ? folderBackground(folder, folders) : null;
  const cardFolder = card ? folders.find((f) => f.id === card.folderId) : null;
  const paneBg = boardBg ?? (cardFolder ? folderBackground(cardFolder, folders) : null);
  // «Работа / Проект» for a folder below the top level.
  const parentName = (f) => {
    const path = folderPath(f, folders);
    return path.length > 1 ? path.slice(0, -1).map((p) => p.name).join(' / ') : null;
  };

  // All chats in one list: the latest message first, those without messages after them.
  const items = [
    ...folders.map((f) => ({
      thread: `folder:${f.id}`, avatar: <FolderAvatar id={f.id} background={folderBackground(f, folders)} />,
      title: f.name, subtitle: parentName(f),
      last: chats.folders[f.id]?.last ?? null, unread: chats.folders[f.id]?.unread ?? 0,
    })),
    ...chats.cards.filter((c) => folderName.has(c.card.folderId)).map((c) => ({
      thread: `card:${c.card.id}`, avatar: <CardAvatar id={c.card.id} background={cardColor(c.card)} />,
      title: cardTitle(c.card),
      subtitle: folders.length > 1 ? folderName.get(c.card.folderId) : null,
      last: c.last, unread: c.unread,
    })),
    ...contacts.map((c) => ({
      thread: `dm:${c.id}`, avatar: <Avatar user={c} size={46} />, title: personName(c),
      last: c.last && !c.last.deleted ? c.last : null, unread: c.unread,
    })),
    ...(support.tickets ?? []).map((t) => ({
      thread: `support:${t.userId}`, avatar: <Avatar user={t.user} size={46} />, title: personName(t.user),
      subtitle: `Обращение · ${STATUS_LABEL[t.status] ?? t.status}`, last: t.last, unread: t.unread,
    })),
  ].sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0) || a.title.localeCompare(b.title, 'ru'));
  // Pinned above the others: always easy to find.
  if (ownSupport) {
    items.unshift({
      thread: 'support:me', avatar: <SupportAvatar size={46} />, title: SUPPORT_NAME,
      subtitle: support.me?.status === 'solved' ? 'Обращение решено' : null,
      last: support.me?.last ?? null, unread: support.me?.unread ?? 0,
      placeholder: 'Вопрос, ошибка или предложение',
    });
  }
  const query = search.trim().toLocaleLowerCase('ru');
  const found = query
    ? items.filter((i) => [i.title, i.subtitle, i.last && messageText(i.last, numbers)]
      .some((text) => text?.toLocaleLowerCase('ru').includes(query)))
    : items;

  return (
    <Modal title="Чаты" onClose={onClose} className="modal-chat" header={false}>
      <div className={`chat-dialog ${open ? 'chat-dialog-open' : ''}`}>
        <nav className="chat-side" aria-label="Чаты">
          <div className="chat-side-head">
            <input className="chat-search" type="search" placeholder="Поиск" aria-label="Поиск по чатам"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <CloseButton className="chat-close-side" onClose={onClose} />
          </div>
          <div className="chat-list">
            {found.map((i) => (
              <ChatListItem key={i.thread} avatar={i.avatar} title={i.title} subtitle={i.subtitle}
                text={i.last && messageText(i.last, numbers)} placeholder={i.placeholder}
                last={i.last} unread={i.unread} active={thread === i.thread} onClick={() => openThread(i.thread)} />
            ))}
            {query && found.length === 0 && <p className="muted chat-list-note">Ничего не найдено.</p>}
          </div>
        </nav>
        <section className={`chat-pane ${paneBg ? 'has-board-bg' : ''}`}
          style={paneBg ? { '--chat-board': paneBg } : undefined}>
          {open ? (
            <>
              <header className="chat-pane-head">
                <button type="button" className="chat-head-btn chat-back" onClick={() => openThread('')}
                  aria-label="К списку чатов" title="К списку чатов">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg>
                </button>
                {folder && <FolderAvatar id={folder.id} background={boardBg} size={40} />}
                {card && <CardAvatar id={card.id} background={cardColor(card)} size={40} />}
                {peer && <Avatar user={peer} size={40} />}
                {supportOpen && (ticket ? <Avatar user={ticket.user} size={40} /> : <SupportAvatar size={40} />)}
                <span className="chat-pane-heading">
                  <strong className="chat-pane-title">
                    {folder ? folder.name : card ? cardTitle(card) : peer ? personName(peer)
                      : ticket ? personName(ticket.user) : SUPPORT_NAME}
                  </strong>
                  <span className="chat-pane-subtitle muted">
                    {folder && (members.length
                      ? `${members.length} ${plural(members.length, 'участник', 'участника', 'участников')}`
                      : parentName(folder) ?? 'Чат папки')}
                    {card && (folderName.get(card.folderId) ?? 'Чат карточки')}
                    {peer && (peer.email || 'Личные сообщения')}
                    {ticket && [ticket.user.email, `обращение · ${(STATUS_LABEL[ticket.status] ?? ticket.status).toLowerCase()}`]
                      .filter(Boolean).join(' · ')}
                    {supportOpen && !ticket && (support.me?.status === 'solved' ? 'Обращение решено' : 'Администраторы сервера')}
                  </span>
                </span>
                {ticket && (
                  <button type="button" className="btn btn-small" disabled={statusBusy || !online}
                    title={ticket.status === 'open' ? 'Отметить обращение решённым' : 'Вернуть обращение в работу'}
                    onClick={async () => {
                      setStatusBusy(true);
                      try {
                        await setSupportStatus(ticket.userId, ticket.status === 'open' ? 'solved' : 'open');
                      } catch (err) {
                        alert(err.message);
                      } finally {
                        setStatusBusy(false);
                      }
                    }}>
                    {ticket.status === 'open' ? 'Решено' : 'Открыть снова'}
                  </button>
                )}
                {members.length > 0 && (
                  <MembersButton people={members} open={membersShown} onToggle={() => setShowMembers(!showMembers)} />
                )}
                {peer && (
                  <button type="button" className="chat-head-btn" onClick={() => setDeletingDm(true)}
                    aria-label="Удалить чат" title="Удалить чат">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
                {card && (
                  <span className="chat-pane-actions">
                    <HistoryToggle />
                    <button type="button" className="btn btn-small" onClick={() => onOpenCard(card.id)}>
                      Открыть карточку
                    </button>
                  </span>
                )}
                <CloseButton className="chat-close-pane" onClose={onClose} />
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
              {supportOpen && <SupportThread key={id} user={id} />}
            </>
          ) : (
            <>
              <CloseButton className="chat-close-float" onClose={onClose} />
              <p className="chat-pane-empty"><span>Выберите, кому хотели бы написать</span></p>
            </>
          )}
        </section>
      </div>
      {deletingDm && peer && (
        <DeleteDmDialog peer={peer} onClose={() => setDeletingDm(false)} onDone={() => {
          setDeletingDm(false);
          openThread('');
        }} />
      )}
    </Modal>
  );
}
