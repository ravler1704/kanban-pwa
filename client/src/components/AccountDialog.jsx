import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authState, deleteAccount, linkAccount, renameUser, signOut, unlinkAccount } from '../auth.js';
import { APK_URL, INSTALL_PAGE, installStore, platform, PLAY_URL, promptInstall } from '../install.js';
import { disablePush, enablePush, PUSH_HINTS, pushState } from '../push.js';
import { openTickets, refreshSupport, supportStore, supportUnread } from '../support.js';
import { syncStatus } from '../sync.js';
import { getTheme, setTheme } from '../theme.js';
import Avatar from './Avatar.jsx';
import { DELETE_WORD } from './ConfirmDelete.jsx';
import Modal from './Modal.jsx';
import MonitorDialog from './MonitorDialog.jsx';
import { EmailCodeForm, GoogleButton, YandexButton } from './ProviderButtons.jsx';
import ServerSettings from './ServerSettings.jsx';
const PROVIDERS = { google: 'Google', yandex: 'Яндекс', email: 'Почта', dev: 'Тестовый' };

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
    if (!confirm(`Отвязать ${what}? Вход через этот аккаунт больше не будет открывать ваше пространство.`)) return;
    await run(() => unlinkAccount(identity));
  }

  return (
    <div className="manage">
      <h4 className="manage-heading">Привязанные аккаунты</h4>
      <p className="muted account-hint">Вход через любой из них открывает ваше пространство.</p>
      {identities.map((i) => (
        <div key={`${i.provider}:${i.subject}`} className="manage-row account-row">
          <Avatar user={i} size={28} />
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
          {auth.emailLogin && (
            <EmailCodeForm link submitLabel="Привязать почту"
              onCode={(email, code) => linkAccount('email', { email, code })} />
          )}
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

      <DeleteAccount online={online} />
    </div>
  );
}

function DeleteAccount({ online }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const { busy, error, run } = useAction();

  if (!open) {
    return (
      <div className="account-delete">
        <button type="button" className="btn btn-small btn-danger" onClick={() => setOpen(true)}>
          Удалить аккаунт…
        </button>
      </div>
    );
  }
  return (
    <form className="account-delete" onSubmit={(e) => {
      e.preventDefault();
      if (word.trim().toLowerCase() === DELETE_WORD) run(deleteAccount);
    }}>
      <h4 className="manage-heading">Удаление аккаунта</h4>
      <p className="account-hint">
        Будут удалены ваше пространство со всеми досками и карточками, привязанные входы, приглашения
        в ваши проекты и публичные ссылки, а также ваш доступ к чужим проектам. Восстановить их будет нельзя.
      </p>
      <label className="field">
        <span className="field-label">Чтобы подтвердить, введите «{DELETE_WORD}»</span>
        <input className="manage-input" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
      </label>
      <div className="manage-row">
        <button type="submit" className="btn btn-danger"
          disabled={busy || !online || word.trim().toLowerCase() !== DELETE_WORD}
          title={online ? undefined : 'Для удаления нужен интернет'}>
          {busy ? 'Удаляем…' : 'Удалить навсегда'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setWord(''); }}>
          Отмена
        </button>
      </div>
      {!online && <p className="muted account-hint">Для удаления нужен интернет.</p>}
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

/** Reminders on this device; `onChange(state)` hears of every change of the push state. */
export function NotificationSettings({ onChange }) {
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
  useEffect(() => onChange?.(push), [push, onChange]);

  return (
    <div className="manage">
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

const THEME_OPTIONS = [
  { id: 'auto', label: 'Как в системе' },
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
];

function AppearanceTab() {
  const [theme, setChoice] = useState(getTheme);

  return (
    <div className="manage">
      <h4 className="manage-heading">Оформление на этом устройстве</h4>
      <div className="theme-options" role="radiogroup" aria-label="Тема">
        {THEME_OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={theme === o.id}
            className={`btn ${theme === o.id ? 'btn-primary' : ''}`}
            onClick={() => {
              setTheme(o.id);
              setChoice(o.id);
            }}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted account-hint">
        «Как в системе» — светлая или тёмная вслед за настройками телефона или компьютера.
      </p>
    </div>
  );
}

const INSTALL_HINTS = {
  ios: 'В Safari нажмите «Поделиться» → «На экран «Домой»» → «Добавить».',
  android: 'Или в меню браузера ⋮ → «Установить приложение» (или «Добавить на главный экран»).',
  desktop: 'В Chrome, Edge или Яндекс Браузере — значок установки в адресной строке; в Safari на Mac — «Файл» → «Добавить в Dock».',
};

function InstallTab() {
  const { installed, canPrompt } = useSyncExternalStore(installStore.subscribe, installStore.get);
  return (
    <div className="manage">
      <h4 className="manage-heading">Приложение на этом устройстве</h4>
      {installed ? <p className="muted account-hint">Приложение уже установлено и открыто.</p> : (
        <>
          <div className="install-buttons">
            {canPrompt && <button type="button" className="btn btn-primary" onClick={promptInstall}>Установить</button>}
            {platform === 'android' && PLAY_URL && <a className="btn" href={PLAY_URL} target="_blank" rel="noreferrer">Google Play</a>}
            {platform === 'android' && <a className="btn" href={APK_URL}>Скачать APK</a>}
          </div>
          <p className="muted account-hint">{INSTALL_HINTS[platform]}</p>
        </>
      )}
      <p className="muted account-hint">
        <a href={INSTALL_PAGE} target="_blank" rel="noreferrer">Все способы установки</a> — Android, iPhone и iPad,
        Windows, macOS и Linux.
      </p>
    </div>
  );
}

const TABS = [
  { id: 'signin', label: 'Вход', Content: SignInTab },
  { id: 'appearance', label: 'Тема', Content: AppearanceTab },
  { id: 'install', label: 'Приложение', Content: InstallTab },
];

/** The server's settings, for its administrator: apart from the account's, they apply to everyone. */
function ServerAdmin({ onChat }) {
  const [open, setOpen] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const support = useSyncExternalStore(supportStore.subscribe, supportStore.get);
  const waiting = openTickets(support);
  const unread = supportUnread(support);
  useEffect(() => {
    refreshSupport();
  }, []);
  return (
    <>
      <div className="server-admin">
        <h4 className="manage-heading">Администрирование сервера</h4>
        <p className="muted account-hint">Вы администратор: эти настройки действуют для всех пользователей сервера.</p>
        <div className="server-admin-buttons">
          <button type="button" className="btn btn-small" onClick={() => setMonitor(true)}>Мониторинг…</button>
          <button type="button" className="btn btn-small" disabled={!support.tickets?.length}
            title={support.tickets?.length ? undefined : 'Обращений пока не было'}
            onClick={() => onChat(waiting[0] ? `support:${waiting[0].userId}` : `support:${support.tickets[0].userId}`)}>
            Обращения{waiting.length ? `: открыто ${waiting.length}` : ''}
            {unread > 0 && <span className="chat-unread account-support-unread">{unread}</span>}
          </button>
          <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>Настройки сервера…</button>
        </div>
      </div>
      {monitor && <MonitorDialog onClose={() => setMonitor(false)} />}
      {open && (
        <Modal title="Настройки сервера" onClose={() => setOpen(false)}>
          <p className="muted account-hint server-admin-note">Действуют для всех пользователей сервера.</p>
          <ServerSettings />
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setOpen(false)}>Готово</button>
          </div>
        </Modal>
      )}
    </>
  );
}
const TAB_KEY = 'accountDialogTab';

/** The user's name: shown in the header under the space's name, to the people they share boards with and in chats. */
function ProfileName() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { busy, error, run } = useAction();
  const current = user?.name ?? '';
  const [name, setName] = useState(current);
  const sent = useRef(null);
  useEffect(() => setName(current), [current]);

  // Enter saves, and so does leaving the field: the same name is sent once.
  const save = () => {
    const next = name.replace(/\s+/g, ' ').trim();
    if (next === current) setName(current);
    else if (next !== sent.current) {
      sent.current = next;
      run(() => renameUser(next).catch((err) => {
        sent.current = null;
        throw err;
      }));
    }
  };

  return (
    <div className="manage account-profile">
      <div className="account-profile-row">
        {user && <Avatar user={user} size={44} />}
        <label className="field manage-field account-profile-name">
          <span className="field-label">Имя</span>
          <input className="manage-input" value={name} maxLength={100} disabled={!online || busy}
            placeholder={user?.accountName || user?.email || 'Как вас называть'}
            onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                save();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') setName(current);
            }} />
        </label>
      </div>
      <p className="muted account-hint">
        {online ? 'Видно вверху экрана, участникам ваших досок и в чатах.' : 'Изменить имя можно только при подключении к интернету.'}
        {user?.customName && user.accountName && user.accountName !== user.customName
          && ` Очистите поле, чтобы вернуть имя из аккаунта (${user.accountName}).`}
      </p>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

export default function AccountDialog({ onClose, onChat }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const [picked, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = TABS.some((t) => t.id === picked) ? picked : TABS[0].id;
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
      <ProfileName />
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
      {user?.admin ? <ServerAdmin onChat={onChat} /> : (
        <div className="account-support">
          <span className="muted account-hint">Вопрос, ошибка или предложение? Администраторы ответят в чате.</span>
          <button type="button" className="btn btn-small" onClick={() => onChat('support:me')}>Написать в техподдержку</button>
        </div>
      )}
      <div className="actions">
        <button className="btn btn-danger" onClick={logout} disabled={!online}
          title={online ? 'Данные этого пространства будут удалены с устройства' : 'Для выхода нужен интернет'}>
          Выйти из аккаунта
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}
