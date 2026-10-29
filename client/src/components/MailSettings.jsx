import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkAuth } from '../auth.js';
import { syncStatus } from '../sync.js';

// The mailbox the sign-in codes are sent from (administrators only).

const PRESETS = [
  {
    id: 'yandex', label: 'Яндекс Почта', host: 'smtp.yandex.ru', port: 465, secure: true,
    hint: 'Нужен пароль приложения: Яндекс ID → «Безопасность» → «Пароли приложений» → «Почта».',
  },
  {
    id: 'mailru', label: 'Mail.ru', host: 'smtp.mail.ru', port: 465, secure: true,
    hint: 'Нужен пароль для внешнего приложения: настройки Mail.ru → «Безопасность» → «Пароли для внешних приложений».',
  },
  {
    id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true,
    hint: 'Нужен пароль приложения (Google Аккаунт → «Безопасность» → «Пароли приложений»), включите двухэтапную проверку.',
  },
  { id: 'other', label: 'Другой сервер', hint: 'Данные SMTP-сервера узнайте у почтового сервиса.' },
];

const presetOf = (s) => PRESETS.find((p) => p.host === s.host && p.port === s.port && p.secure === s.secure)?.id ?? 'other';

async function call(url, body) {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (data.error === 'smtp failed') throw new Error(`Почтовый сервер не принял настройки: ${data.detail}`);
  if (data.error === 'invalid settings') throw new Error('Проверьте заполнение полей.');
  if (data.error === 'not admin') throw new Error('Настройка доступна только администратору.');
  throw new Error('Не удалось выполнить действие. Попробуйте ещё раз.');
}

export default function MailSettings() {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  function load(settings) {
    setSaved(settings);
    const base = settings.source ? settings : { ...PRESETS[0], user: '', from: '' };
    setForm({
      preset: settings.source ? presetOf(settings) : PRESETS[0].id,
      host: base.host, port: String(base.port), secure: base.secure, user: base.user ?? '', pass: '', from: base.from ?? '',
    });
  }

  useEffect(() => {
    if (online) call('/api/admin/mail').then(load, (err) => setError(err.message));
  }, [online]);

  async function act(action) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function pickPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    set(preset.host ? { preset: id, host: preset.host, port: String(preset.port), secure: preset.secure } : { preset: id });
  }

  const save = (e) => {
    e.preventDefault();
    act(async () => {
      load(await call('/api/admin/mail', {
        host: form.host.trim(), port: Number(form.port), secure: form.secure,
        user: form.user.trim(), pass: form.pass || null, from: form.from.trim(),
      }));
      setMessage('Сохранено: сервер принял логин и пароль. Вход по почте включён.');
      checkAuth();
    });
  };

  const test = () => act(async () => {
    const { to } = await call('/api/admin/mail/test', {});
    setMessage(`Тестовое письмо отправлено на ${to}.`);
  });

  const remove = () => {
    if (!confirm('Удалить настройки почты? Вход по почте перестанет работать.')) return;
    act(async () => {
      load(await call('/api/admin/mail/remove', {}));
      setMessage('Настройки удалены, вход по почте выключен.');
      checkAuth();
    });
  };

  if (!online) return <p className="muted">Для настройки нужен интернет.</p>;
  if (!form) return error ? <p className="login-error">{error}</p> : <p className="muted">Загрузка…</p>;

  const fromEnv = saved.source === 'env';
  const preset = PRESETS.find((p) => p.id === form.preset);
  const needsPassword = !saved.hasPassword || fromEnv;

  return (
    <form className="manage mail-settings" onSubmit={save}>
      <h4 className="manage-heading">Почта для кодов входа</h4>
      <p className="muted account-hint">
        С этого ящика приходят коды для входа по почте. {saved.source
          ? 'Вход по почте включён.'
          : 'Пока ящик не указан, вход по почте выключен.'}
      </p>
      {fromEnv && (
        <p className="notice">Почта задана в файле настроек сервера (SMTP_URL) — изменить её можно только там.</p>
      )}
      <fieldset className="mail-fields" disabled={fromEnv || busy}>
        <label className="field">
          <span className="field-label">Почтовый сервис</span>
          <select className="select" value={form.preset} onChange={(e) => pickPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {form.preset === 'other' && (
          <div className="manage-row">
            <label className="field manage-field">
              <span className="field-label">SMTP-сервер</span>
              <input className="manage-input" value={form.host} onChange={(e) => set({ host: e.target.value })} />
            </label>
            <label className="field mail-port">
              <span className="field-label">Порт</span>
              <input className="manage-input" inputMode="numeric" value={form.port}
                onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="mail-ssl">
              <input type="checkbox" checked={form.secure} onChange={(e) => set({ secure: e.target.checked })} />
              SSL
            </label>
          </div>
        )}
        <label className="field">
          <span className="field-label">Адрес ящика (логин)</span>
          <input className="manage-input" type="email" autoComplete="off" value={form.user}
            onChange={(e) => set({ user: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Пароль приложения</span>
          <input className="manage-input" type="password" autoComplete="new-password" value={form.pass}
            placeholder={needsPassword ? '' : 'сохранён — введите, чтобы заменить'}
            onChange={(e) => set({ pass: e.target.value })} />
        </label>
        {preset?.hint && <p className="muted account-hint">{preset.hint}</p>}
        <label className="field">
          <span className="field-label">Отправитель (необязательно)</span>
          <input className="manage-input" value={form.from} placeholder={'"Канбан" <адрес ящика>'}
            onChange={(e) => set({ from: e.target.value })} />
        </label>
      </fieldset>
      <div className="manage-row mail-actions">
        {!fromEnv && (
          <button type="submit" className="btn btn-small btn-primary"
            disabled={busy || !form.host.trim() || !form.port || !form.user.trim() || (needsPassword && !form.pass)}>
            Проверить и сохранить
          </button>
        )}
        {saved.source && <button type="button" className="btn btn-small" disabled={busy} onClick={test}>Тестовое письмо</button>}
        {saved.source === 'app' && (
          <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={remove}>Удалить</button>
        )}
      </div>
      {busy && <p className="muted">Подождите…</p>}
      {message && <p className="mail-ok">{message}</p>}
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}
