import { useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { sync, syncStatus } from '../sync.js';
import AccountDialog from './AccountDialog.jsx';

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

  return (
    <header className="statusbar">
      <h1>Канбан</h1>
      <div className="status">
        <span className={`dot dot-${state}`} />
        <span>{label}</span>
        {pending > 0 && <span className="badge badge-pending">Не синхронизировано: {pending}</span>}
        {conflicts > 0 && <span className="badge badge-conflict">Конфликты: {conflicts}</span>}
        <span className="muted">Синхр.: {formatTime(s.lastSyncAt)}</span>
        <button className="btn btn-small" onClick={sync} disabled={!s.online || s.syncing}>
          Синхронизировать
        </button>
        {user && (
          <button className="btn btn-small" onClick={() => setAccountOpen(true)} title={user.email}>
            Аккаунт
          </button>
        )}
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </header>
  );
}
