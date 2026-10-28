import { useState, useSyncExternalStore } from 'react';
import { authState, linkAccount, signOut, unlinkAccount } from '../auth.js';
import { disablePush, enablePush, PUSH_HINTS, pushState } from '../push.js';
import { syncStatus } from '../sync.js';
import Modal from './Modal.jsx';
import { GoogleButton, YandexButton } from './ProviderButtons.jsx';

const PROVIDERS = { google: 'Google', yandex: 'Яндекс', dev: 'Тестовый' };

export default function AccountDialog({ onClose }) {
  const auth = useSyncExternalStore(authState.subscribe, authState.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const identities = auth.user?.identities ?? [];
  const [push, setPush] = useState(pushState);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(identity) {
    const what = `${PROVIDERS[identity.provider] ?? identity.provider} ${identity.email ?? ''}`.trim();
    if (!confirm(`Отвязать ${what}? Вход через этот аккаунт больше не будет открывать эту доску.`)) return;
    await run(() => unlinkAccount(identity));
  }

  async function logout() {
    if (await signOut()) onClose();
  }

  return (
    <Modal title="Аккаунт" onClose={onClose}>
      <div className="manage">
        <h4 className="manage-heading">Привязанные аккаунты</h4>
        <p className="muted account-hint">Вход через любой из них открывает эту доску.</p>
        {identities.map((i) => (
          <div key={`${i.provider}:${i.subject}`} className="manage-row account-row">
            <span className="account-provider">{PROVIDERS[i.provider] ?? i.provider}</span>
            <span className="account-email">{i.email || i.name || '—'}</span>
            {identities.length > 1 && (
              <button className="btn btn-small" disabled={busy || !online} onClick={() => unlink(i)}>Отвязать</button>
            )}
          </div>
        ))}

        <h4 className="manage-heading">Привязать ещё</h4>
        {online ? (
          <div className="account-link">
            {auth.clientId && (
              <GoogleButton clientId={auth.clientId} text="continue_with" onError={setError}
                onCredential={(credential) => run(() => linkAccount('google', { credential }))} />
            )}
            {auth.yandexClientId && <YandexButton link disabled={busy}>Привязать Яндекс ID</YandexButton>}
            {auth.devLogin && !identities.some((i) => i.provider === 'dev') && (
              <button type="button" className="btn login-dev" disabled={busy}
                onClick={() => run(() => linkAccount('dev', {}))}>
                Привязать тестовый аккаунт
              </button>
            )}
          </div>
        ) : (
          <p className="muted">Для привязки нужен интернет.</p>
        )}
        <h4 className="manage-heading">Напоминания на этом устройстве</h4>
        {push === 'enabled' && (
          <div className="manage-row account-row">
            <span className="account-email">Уведомления включены</span>
            <button className="btn btn-small" disabled={busy}
              onClick={() => run(async () => { await disablePush(); setPush(pushState()); })}>
              Выключить
            </button>
          </div>
        )}
        {push === 'available' && (
          <div className="manage-row account-row">
            <span className="account-email muted">Уведомления выключены</span>
            <button className="btn btn-small" disabled={busy || !online}
              onClick={() => run(async () => {
                try {
                  await enablePush();
                } finally {
                  setPush(pushState());
                }
              })}>
              Включить
            </button>
          </div>
        )}
        {push !== 'enabled' && push !== 'available' && <p className="muted account-hint">{PUSH_HINTS[push]}</p>}
        {busy && <p className="muted">Подождите…</p>}
        {error && <p className="login-error">{error}</p>}
      </div>
      <div className="actions">
        <button className="btn" onClick={logout} disabled={!online || busy}>Выйти</button>
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}
