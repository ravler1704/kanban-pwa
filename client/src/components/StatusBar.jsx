import { useEffect, useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { boardName, currentBoard, publicToken, switchBoard } from '../board.js';
import { usePublicLink } from '../public.js';
import { sync, syncStatus } from '../sync.js';
import { pushState } from '../push.js';
import AccountDialog, { NotificationSettings } from './AccountDialog.jsx';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import { ChatButton } from './People.jsx';

function SyncIcon({ spinning }) {
  return (
    <svg className={spinning ? 'spin' : undefined} width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** A bell; crossed out while reminders don't come to this device. */
function BellIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** On a public link: whose folder it is and what the visitor may do. */
function PublicTitle() {
  const { info } = usePublicLink();
  const owner = info?.owner?.name;
  return (
    <div className="statusbar-user">
      {info?.owner && <Avatar user={info.owner} />}
      <h1 className="statusbar-title" title={owner ? `Владелец: ${owner}` : undefined}>
        {info?.project.name ?? 'Доска'}
      </h1>
      {info && <span className="badge public-mode">{info.mode === 'edit' ? 'Можно редактировать' : 'Только просмотр'}</span>}
    </div>
  );
}

/** `search` is the text of the search through all cards; `onSearch(text)` changes it. */
export default function StatusBar({ pending, conflicts, folders, onChat, search, onSearch }) {
  const s = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [push, setPush] = useState(pushState);
  // On a phone the state shows as a dot only; a tap on it tells the state and the last sync.
  const [stateOpen, setStateOpen] = useState(false);
  useEffect(() => {
    if (!stateOpen) return undefined;
    const close = () => setStateOpen(false);
    const timer = setTimeout(close, 4000);
    window.addEventListener('pointerdown', close);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', close);
    };
  }, [stateOpen]);

  let state = 'online';
  let label = 'Онлайн';
  if (!s.online) {
    state = 'offline';
    label = 'Офлайн — изменения сохраняются на устройстве';
  } else if (s.syncing) {
    state = 'syncing';
    label = 'Синхронизация…';
  } else if (!s.serverReachable) {
    state = 'offline';
    label = 'Сервер недоступен';
  }

  const boards = user?.boards ?? [];
  // On someone else's board, the header shows whose it is.
  const boardOwner = currentBoard ? boards.find((b) => b.id === currentBoard) : null;

  return (
    <header className="statusbar">
      {publicToken ? <PublicTitle /> : <div className="statusbar-user">
        {user && <Avatar user={boardOwner ?? user} />}
        {boards.length > 0 || currentBoard ? (
          <select className="select board-select" aria-label="Пространство" value={currentBoard ?? ''}
            title={user?.name || user?.email || undefined} onChange={(e) => switchBoard(e.target.value || null)}>
            <option value="">Моё пространство</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{boardName(b)}</option>)}
            {currentBoard && !boards.some((b) => b.id === currentBoard) && <option value={currentBoard}>Общее пространство</option>}
          </select>
        ) : (
          <h1 className="statusbar-title" title={user?.email || undefined}>{user?.name || user?.email || 'Канбан'}</h1>
        )}
      </div>}
      {onSearch && (
        <label className="fp-search header-search">
          <SearchIcon />
          <input type="search" placeholder="Найти карточку" value={search}
            title="Номер, название или описание; ищет на всех досках" aria-label="Найти карточку на всех досках"
            onChange={(e) => onSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onSearch('')} />
        </label>
      )}
      <div className="status">
        <button type="button" className="status-state" aria-expanded={stateOpen}
          title={`${label}. Синхр.: ${formatTime(s.lastSyncAt)}`} onClick={() => setStateOpen(!stateOpen)}>
          <span className={`dot dot-${state}`} />
          <span className="status-label">{label}</span>
          {stateOpen && (
            <span className="status-pop" role="status">{label}<br />Синхр.: {formatTime(s.lastSyncAt)}</span>
          )}
        </button>
        {pending > 0 && <span className="badge badge-pending">Не синхронизировано: {pending}</span>}
        {conflicts > 0 && <span className="badge badge-conflict">Конфликты: {conflicts}</span>}
        <span className="muted status-time">Синхр.: {formatTime(s.lastSyncAt)}</span>
        <button className="btn btn-small btn-icon-only" onClick={sync} disabled={!s.online || s.syncing}
          title="Синхронизировать" aria-label="Синхронизировать">
          <SyncIcon spinning={s.syncing} />
        </button>
        {publicToken && <a className="btn btn-small" href="/" title="Открыть своё пространство">Мой Канбан</a>}
        {user && !publicToken && (
          <button className={`btn btn-small btn-icon-only ${push === 'enabled' ? '' : 'notifications-off'}`}
            onClick={() => setNotificationsOpen(true)}
            title={push === 'enabled' ? 'Уведомления включены' : 'Уведомления выключены'} aria-label="Уведомления">
            <BellIcon off={push !== 'enabled'} />
          </button>
        )}
        {user && !publicToken && (
          <button className="btn btn-small btn-icon-only" onClick={() => setAccountOpen(true)}
            title={user.email ? `Аккаунт: ${user.email}` : 'Аккаунт'} aria-label="Аккаунт">
            <AccountIcon />
          </button>
        )}
        {user && !publicToken && <ChatButton folders={folders} onChat={onChat} />}
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
      {notificationsOpen && (
        <Modal title="Уведомления" onClose={() => setNotificationsOpen(false)} className="notifications-dialog" closeButton>
          <NotificationSettings onChange={setPush} />
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setNotificationsOpen(false)}>Готово</button>
          </div>
        </Modal>
      )}
    </header>
  );
}
