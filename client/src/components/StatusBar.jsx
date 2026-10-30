import { useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { boardName, currentBoard, publicToken, switchBoard } from '../board.js';
import { usePublicLink } from '../public.js';
import { sync, syncStatus } from '../sync.js';
import AccountDialog from './AccountDialog.jsx';
import Avatar from './Avatar.jsx';
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

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** On a public link: whose project it is and what the visitor may do. */
function PublicTitle() {
  const { info } = usePublicLink();
  const owner = info?.owner?.name;
  return (
    <div className="statusbar-user">
      {info?.owner && <Avatar user={info.owner} />}
      <h1 className="statusbar-title" title={owner ? `Владелец: ${owner}` : undefined}>
        {info?.project.name ?? 'Проект'}
      </h1>
      {info && <span className="badge public-mode">{info.mode === 'edit' ? 'Можно редактировать' : 'Только просмотр'}</span>}
    </div>
  );
}

export default function StatusBar({ pending, conflicts, spaces, projects, onChat }) {
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
  // On someone else's board, the header shows whose it is.
  const boardOwner = currentBoard ? boards.find((b) => b.id === currentBoard) : null;

  return (
    <header className="statusbar">
      {publicToken ? <PublicTitle /> : <div className="statusbar-user">
        {user && <Avatar user={boardOwner ?? user} />}
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
      </div>}
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
        {publicToken && <a className="btn btn-small" href="/" title="Открыть свою доску">Мой Канбан</a>}
        {user && !publicToken && (
          <button className="btn btn-small btn-icon-only" onClick={() => setAccountOpen(true)}
            title={user.email ? `Аккаунт: ${user.email}` : 'Аккаунт'} aria-label="Аккаунт">
            <AccountIcon />
          </button>
        )}
        {user && !publicToken && <ChatButton spaces={spaces} projects={projects} onChat={onChat} />}
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </header>
  );
}
