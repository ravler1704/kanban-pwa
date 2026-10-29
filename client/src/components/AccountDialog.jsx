import { useEffect, useState, useSyncExternalStore } from 'react';
import { authState, linkAccount, signOut, unlinkAccount } from '../auth.js';
import { disablePush, enablePush, PUSH_HINTS, pushState } from '../push.js';
import { syncStatus } from '../sync.js';
import Modal from './Modal.jsx';
import { GoogleButton, YandexButton } from './ProviderButtons.jsx';
import SharingSection from './SharingSection.jsx';

const PROVIDERS = { google: 'Google', yandex: 'Яндекс', dev: 'Тестовый' };

/** `busy` and `error` of one tab's actions; `run` wraps an action with them. */
function useAction() {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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

  return { busy, error, setError, run };
}

function SignInTab() {
  const auth = useSyncExternalStore(authState.subscribe, authState.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { busy, error, setError, run } = useAction();
  const identities = auth.user?.identities ?? [];

  async function unlink(identity) {
    const what = `${PROVIDERS[identity.provider] ?? identity.provider} ${identity.email ?? ''}`.trim();
    if (!confirm(`Отвязать ${what}? Вход через этот аккаунт больше не будет открывать вашу доску.`)) return;
    await run(() => unlinkAccount(identity));
  }

  return (
    <div className="manage">
      <h4 className="manage-heading">Привязанные аккаунты</h4>
      <p className="muted account-hint">Вход через любой из них открывает вашу доску.</p>
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
      {busy && <p className="muted">Подождите…</p>}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

function NotificationsTab() {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { busy, error, run } = useAction();
  const [push, setPush] = useState(pushState);

  // Permission can only be restored in the browser/OS settings: pick that up when the user returns.
  useEffect(() => {
    const recheck = () => setPush(pushState());
    let status;
    navigator.permissions?.query({ name: 'notifications' }).then((s) => {
      status = s;
      status.addEventListener('change', recheck);
    }).catch(() => {});
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      status?.removeEventListener('change', recheck);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  return (
    <div className="manage">
      <h4 className="manage-heading">Напоминания на этом устройстве</h4>
      <p className="muted account-hint">
        Напоминания по карточкам приходят на все устройства, где включены уведомления.
      </p>
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
      {push === 'denied' && (
        <button className="btn btn-small" onClick={() => setPush(pushState())}>Я разрешил — проверить</button>
      )}
      {busy && <p className="muted">Подождите…</p>}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

const TABS = [
  { id: 'signin', label: 'Вход', Content: SignInTab },
  { id: 'sharing', label: 'Доступ', Content: () => <div className="manage"><SharingSection /></div> },
  { id: 'notifications', label: 'Уведомления', Content: NotificationsTab },
];
const TAB_KEY = 'accountDialogTab';

export default function AccountDialog({ onClose }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
  });
  const { Content } = TABS.find((t) => t.id === tab);

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  async function logout() {
    if (await signOut()) onClose();
  }

  return (
    <Modal title="Аккаунт" onClose={onClose}>
      <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel"><Content /></div>
      <div className="actions">
        <button className="btn" onClick={logout} disabled={!online}>Выйти</button>
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}
