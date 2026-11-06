import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkAuth } from '../auth.js';
import { syncStatus } from '../sync.js';
import MailSettings from './MailSettings.jsx';

// The server's settings, for administrators: ways to sign in, who may sign in, push contact.

const FIELD_NAMES = {
  googleClientId: 'Client ID Google', yandexClientId: 'ClientID Яндекса', allowedEmails: 'список адресов',
  adminEmails: 'список администраторов', vapidSubject: 'контакт',
};

async function call(body) {
  const res = await fetch('/api/admin/settings', body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (data.error === 'invalid settings') {
    const field = FIELD_NAMES[data.detail?.replace(/^invalid /, '')];
    throw new Error(field ? `Проверьте поле: ${field}.` : 'Проверьте заполнение полей.');
  }
  if (data.error === 'last sign-in way') throw new Error('Должен остаться хотя бы один способ входа: Google, Яндекс или почта.');
  if (data.error === 'last admin') throw new Error('Нельзя убрать из администраторов себя.');
  if (data.error === 'not admin') throw new Error('Настройка доступна только администратору.');
  throw new Error('Не удалось сохранить. Попробуйте ещё раз.');
}

const toLines = (list) => list.join('\n');
const fromLines = (text) => text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);

/** A part of the settings with its own «Сохранить»: `fields(form)` turns the form into what is sent. */
function Section({ saved, onSaved, initial, fields, children, note }) {
  const [form, setForm] = useState(() => initial(saved));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const changed = JSON.stringify(fields(form)) !== JSON.stringify(fields(initial(saved)));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await call(fields(form));
      onSaved(next);
      setForm(initial(next));
      setMessage(note ?? 'Сохранено.');
      checkAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="manage mail-settings" onSubmit={save}>
      <fieldset className="mail-fields" disabled={busy}>
        {children(form, (patch) => setForm((f) => ({ ...f, ...patch })))}
      </fieldset>
      <div className="manage-row mail-actions">
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !changed}>Сохранить</button>
      </div>
      {message && !changed && <p className="mail-ok">{message}</p>}
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

function SignInTab(props) {
  return (
    <Section {...props} note="Сохранено. Кнопки входа обновятся у пользователей после перезагрузки страницы."
      initial={(s) => ({ google: s.googleClientId, yandex: s.yandexClientId })}
      fields={(f) => ({ googleClientId: f.google.trim(), yandexClientId: f.yandex.trim() })}>
      {(form, set) => (
        <>
          <h4 className="manage-heading">Вход через Google</h4>
          <label className="field">
            <span className="field-label">Client ID</span>
            <input className="manage-input" value={form.google} autoComplete="off" spellCheck={false}
              placeholder="…apps.googleusercontent.com" onChange={(e) => set({ google: e.target.value })} />
          </label>
          <p className="muted account-hint">
            Google Cloud Console → «APIs &amp; Services» → «Credentials» → OAuth client ID типа «Web application»;
            в «Authorized JavaScript origins» — <code>{location.origin}</code>. Пусто — вход через Google выключен.
          </p>
          <h4 className="manage-heading">Вход через Яндекс</h4>
          <label className="field">
            <span className="field-label">ClientID</span>
            <input className="manage-input" value={form.yandex} autoComplete="off" spellCheck={false}
              onChange={(e) => set({ yandex: e.target.value })} />
          </label>
          <p className="muted account-hint">
            Приложение на oauth.yandex.ru, платформа «Веб-сервисы», доступы — адрес почты, имя и портрет;
            Redirect URI — <code>{location.origin}/</code>. Секрет не нужен. Пусто — вход через Яндекс выключен.
          </p>
        </>
      )}
    </Section>
  );
}

function UsersTab(props) {
  const { saved } = props;
  return (
    <Section {...props}
      initial={(s) => ({ allowed: toLines(s.allowedEmails), admins: toLines(s.adminEmails) })}
      fields={(f) => ({ allowedEmails: fromLines(f.allowed), adminEmails: fromLines(f.admins) })}>
      {(form, set) => (
        <>
          <h4 className="manage-heading">Кто может войти</h4>
          <label className="field">
            <span className="field-label">Адреса почты, по одному в строке</span>
            <textarea className="manage-input settings-list" rows={4} value={form.allowed} spellCheck={false}
              onChange={(e) => set({ allowed: e.target.value })} />
          </label>
          <p className="muted account-hint">
            Пусто — войти может кто угодно. Приглашённые в чужие пространства и администраторы входят всегда.
            Удаление адреса сразу закрывает его сессии.
          </p>
          <h4 className="manage-heading">Администраторы</h4>
          <label className="field">
            <span className="field-label">Адреса почты, по одному в строке</span>
            <textarea className="manage-input settings-list" rows={3} value={form.admins} spellCheck={false}
              onChange={(e) => set({ admins: e.target.value })} />
          </label>
          <p className="muted account-hint">
            Администратор — любой, у кого среди привязанных входов есть такой адрес. Себя убрать нельзя.
          </p>
          {saved.envAdminEmails.length > 0 && (
            <p className="muted account-hint">
              Из файла настроек сервера (ADMIN_EMAILS), всегда администраторы: {saved.envAdminEmails.join(', ')}.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function PushTab(props) {
  return (
    <Section {...props}
      initial={(s) => ({ subject: s.vapidSubject })}
      fields={(f) => ({ vapidSubject: f.subject.trim() })}>
      {(form, set) => (
        <>
          <h4 className="manage-heading">Контакт для push-уведомлений</h4>
          <label className="field">
            <span className="field-label">Адрес сайта или mailto:</span>
            <input className="manage-input" value={form.subject} autoComplete="off" spellCheck={false}
              placeholder="https://example.com" onChange={(e) => set({ subject: e.target.value })} />
          </label>
          <p className="muted account-hint">
            Передаётся сервисам push-уведомлений браузеров вместе с напоминаниями, чтобы с вами могли связаться.
            Нужен настоящий адрес: https://… или mailto:имя@домен (Apple не принимает localhost).
          </p>
        </>
      )}
    </Section>
  );
}

const TABS = [
  { id: 'signin', label: 'Вход', Content: SignInTab },
  { id: 'mail', label: 'Почта' },
  { id: 'users', label: 'Пользователи', Content: UsersTab },
  { id: 'push', label: 'Уведомления', Content: PushTab },
];
const TAB_KEY = 'serverSettingsTab';

export default function ServerSettings() {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = TABS.some((t) => t.id === picked) ? picked : TABS[0].id;
  const { Content } = TABS.find((t) => t.id === tab);

  useEffect(() => {
    if (online) call().then(setSaved, (err) => setError(err.message));
  }, [online]);

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  return (
    <>
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
      <div role="tabpanel">
        {tab === 'mail' ? <MailSettings /> : !online ? <p className="muted">Для настройки нужен интернет.</p>
          : saved ? <Content key={tab} saved={saved} onSaved={setSaved} />
            : error ? <p className="login-error">{error}</p> : <p className="muted">Загрузка…</p>}
      </div>
    </>
  );
}
