import { useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { boardName, currentBoard, switchBoard } from '../board.js';
import { sync, syncStatus } from '../sync.js';
import AccountDialog from './AccountDialog.jsx';
import Avatar from './Avatar.jsx';

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

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function StatusBar({ pending, conflicts }) {
  const s = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const [accountOpen, setAccountOpen] = useState(false);

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

  return (
    <header className="statusbar">
      <div className="statusbar-user">
        {user && <Avatar user={user} />}
        {boards.length > 0 || currentBoard ? (
          <select className="select board-select" aria-label="Доска" value={currentBoard ?? ''}
            title={user?.name || user?.email || undefined} onChange={(e) => switchBoard(e.target.value || null)}>
            <option value="">Моя доска</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{boardName(b)}</option>)}
            {currentBoard && !boards.some((b) => b.id === currentBoard) && <option value={currentBoard}>Общая доска</option>}
          </select>
        ) : (
          <h1 className="statusbar-title" title={user?.email || undefined}>{user?.name || user?.email || 'Канбан'}</h1>
        )}
      </div>
      <div className="status">
        <span className={`dot dot-${state}`} />
        <span>{label}</span>
        {pending > 0 && <span className="badge badge-pending">Не синхронизировано: {pending}</span>}
        {conflicts > 0 && <span className="badge badge-conflict">Конфликты: {conflicts}</span>}
        <span className="muted">Синхр.: {formatTime(s.lastSyncAt)}</span>
        <button className="btn btn-small btn-icon-only" onClick={sync} disabled={!s.online || s.syncing}
          title="Синхронизировать" aria-label="Синхронизировать">
          <SyncIcon spinning={s.syncing} />
        </button>
        {user && (
          <button className="btn btn-small btn-icon-only" onClick={() => setAccountOpen(true)}
            title={user.email ? `Аккаунт: ${user.email}` : 'Аккаунт'} aria-label="Аккаунт">
            <AccountIcon />
          </button>
        )}
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </header>
  );
}
