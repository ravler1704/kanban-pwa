import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { syncStatus } from '../sync.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';

// For administrators: who uses the server and how much they keep on it. Counts and dates only,
// the contents of boards stay private.

const PROVIDERS = { google: 'Google', yandex: 'Яндекс', email: 'Почта', dev: 'Тест' };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function ago(at, now) {
  if (!at) return '—';
  const d = now - at;
  if (d < 2 * MINUTE) return 'только что';
  if (d < 60 * MINUTE) return `${Math.floor(d / MINUTE)} мин назад`;
  if (d < DAY) return `${Math.floor(d / 60 / MINUTE)} ч назад`;
  if (d < 2 * DAY) return 'вчера';
  if (d < 30 * DAY) return `${Math.floor(d / DAY)} дн назад`;
  return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const date = (at) => (at ? new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function bytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const num = (n) => (n ? n.toLocaleString('ru-RU') : '0');

const lastActive = (u, now) => (u.online ? now : u.seen ?? 0);

const COLUMNS = [
  { id: 'name', label: 'Пользователь', value: (u) => (u.name || u.email || '').toLowerCase() },
  { id: 'seen', label: 'Активность', value: lastActive },
  { id: 'registered', label: 'Регистрация', value: (u) => u.registered ?? 0 },
  { id: 'spaces', label: 'Простр.', value: (u) => u.spaces.length, number: true },
  { id: 'boards', label: 'Досок', value: (u) => u.boards, number: true },
  { id: 'cards', label: 'Карточек', value: (u) => u.cards, number: true },
  { id: 'members', label: 'Участников', value: (u) => u.members, number: true,
    title: 'Сколько людей приглашено в пространства пользователя' },
  { id: 'shared', label: 'В чужих', value: (u) => u.sharedWithMe, number: true,
    title: 'В скольких чужих пространствах у пользователя есть доступ' },
  { id: 'files', label: 'Файлы', value: (u) => u.fileBytes, number: true },
];

async function load() {
  const res = await fetch('/api/admin/overview', { cache: 'no-store' });
  if (res.status === 403) throw new Error('Доступно только администратору.');
  if (!res.ok) throw new Error('Не удалось загрузить данные. Попробуйте ещё раз.');
  return res.json();
}

function Tile({ label, value, note }) {
  return (
    <div className="monitor-tile">
      <div className="monitor-tile-value">{value}</div>
      <div className="monitor-tile-label">{label}</div>
      {note && <div className="monitor-tile-note muted">{note}</div>}
    </div>
  );
}

function Spaces({ user, now }) {
  return (
    <table className="monitor-spaces">
      <thead>
        <tr>
          <th>Пространство</th><th>Досок</th><th>Карточек</th><th>В архиве</th><th>Сообщений</th>
          <th>Участников</th><th>Ссылок</th><th>Файлы</th><th>Изменено</th>
        </tr>
      </thead>
      <tbody>
        {user.spaces.map((s) => (
          <tr key={s.id}>
            <td>{s.name}{s.main && <span className="muted"> · основное</span>}</td>
            <td>{num(s.boards)}</td><td>{num(s.cards)}</td><td>{num(s.archived)}</td><td>{num(s.messages)}</td>
            <td>{num(s.members)}</td><td>{num(s.links)}</td><td>{s.fileBytes ? bytes(s.fileBytes) : '—'}</td>
            <td>{ago(s.changed, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UserCell({ u, now }) {
  return (
    <div className="monitor-user">
      <span className="monitor-avatar">
        <Avatar user={u} size={28} />
        {u.online && <span className="monitor-online" title="Сейчас в приложении" />}
      </span>
      <span className="monitor-user-text">
        <span className="monitor-user-name">
          {u.name || u.email || u.id}
          {u.admin && <span className="monitor-badge">админ</span>}
        </span>
        <span className="muted monitor-user-sub">
          {[u.name && u.email, u.providers.map((p) => PROVIDERS[p] ?? p).join(', ')].filter(Boolean).join(' · ')}
          {u.devices > 0 && ` · уведомления на ${u.devices} устр.`}
        </span>
        <span className="muted monitor-user-sub monitor-narrow">
          {u.online ? 'в приложении' : ago(u.seen, now)} · досок {u.boards} · карточек {u.cards}
        </span>
      </span>
    </div>
  );
}

export default function MonitorDialog({ onClose }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ id: 'seen', desc: true });
  const [open, setOpen] = useState(() => new Set());

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (online) refresh();
  }, [online]);

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const now = data?.at ?? Date.now();
  const t = data?.totals;
  const q = query.trim().toLowerCase();
  const column = COLUMNS.find((c) => c.id === sort.id);
  const users = (data?.users ?? [])
    .filter((u) => !q || [u.name, u.email, ...u.spaces.map((s) => s.name)].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = column.value(a, now);
      const y = column.value(b, now);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });

  const sortBy = (id) => setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: id !== 'name' }));

  return (
    <Modal title="Мониторинг" className="monitor-dialog" closeButton onClose={onClose}
      headerEnd={(
        <button type="button" className="btn btn-small monitor-refresh" disabled={busy || !online} onClick={refresh}>
          {busy ? 'Обновляем…' : 'Обновить'}
        </button>
      )}>
      {!online && <p className="muted">Для мониторинга нужен интернет.</p>}
      {error && <p className="login-error">{error}</p>}
      {!data && online && !error && <p className="muted">Загружаем…</p>}
      {t && (
        <>
          <div className="monitor-tiles">
            <Tile label="Пользователей" value={num(t.users)} note={t.new30 ? `+${t.new30} за 30 дней` : 'новых за 30 дней нет'} />
            <Tile label="Сейчас в приложении" value={num(t.online)}
              note={`за сутки ${t.active1} · 7 дн ${t.active7} · 30 дн ${t.active30}`} />
            <Tile label="Пространств" value={num(t.spaces)} />
            <Tile label="Досок" value={num(t.boards)} />
            <Tile label="Карточек" value={num(t.cards)} note={`в архиве ${num(t.archived)}`} />
            <Tile label="Сообщений" value={num(t.messages)} note="в чатах досок и личных" />
            <Tile label="Файлов" value={num(t.files)} note={bytes(t.fileBytes)} />
            <Tile label="База данных" value={bytes(t.dbBytes)}
              note={t.diskFree == null ? null : `свободно на диске ${bytes(t.diskFree)}`} />
          </div>

          <div className="monitor-toolbar">
            <input className="manage-input monitor-search" type="search" value={query} placeholder="Имя, почта или пространство"
              aria-label="Поиск пользователя" onChange={(e) => setQuery(e.target.value)} />
            <span className="muted">
              {q ? `Найдено: ${users.length} из ${t.users}` : `Данные на ${new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </div>

          <div className="monitor-table-wrap">
            <table className="monitor-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.id} className={`${c.number ? 'num' : ''} ${c.id === 'name' ? '' : 'monitor-wide'}`} title={c.title}
                      aria-sort={sort.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="monitor-sort" onClick={() => sortBy(c.id)}>
                        {c.label}{sort.id === c.id ? (sort.desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Fragment key={u.id}>
                    <tr className={`monitor-row ${open.has(u.id) ? 'monitor-row-open' : ''}`} onClick={() => toggle(u.id)}
                      aria-expanded={open.has(u.id)}>
                      <td><UserCell u={u} now={now} /></td>
                      <td className="monitor-wide">{u.online ? <span className="monitor-now">в приложении</span> : ago(u.seen, now)}</td>
                      <td className="monitor-wide">{date(u.registered)}</td>
                      <td className="num monitor-wide">{u.spaces.length}</td>
                      <td className="num monitor-wide">{num(u.boards)}</td>
                      <td className="num monitor-wide">
                        {num(u.cards)}
                        {u.archived > 0 && <span className="muted monitor-sub-num"> +{num(u.archived)} арх.</span>}
                      </td>
                      <td className="num monitor-wide">{num(u.members)}</td>
                      <td className="num monitor-wide">{num(u.sharedWithMe)}</td>
                      <td className="num monitor-wide">{u.fileBytes ? bytes(u.fileBytes) : '—'}</td>
                    </tr>
                    {open.has(u.id) && (
                      <tr className="monitor-details">
                        <td colSpan={COLUMNS.length}>
                          <div className="monitor-details-inner">
                            <p className="muted account-hint">
                              Зарегистрирован {date(u.registered)} · последнее изменение в его пространствах {ago(u.changed, now)}
                              {u.sharedWithMe > 0 && ` · доступ к чужим пространствам: ${u.sharedWithMe}`}
                            </p>
                            <div className="monitor-table-wrap"><Spaces user={u} now={now} /></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={COLUMNS.length} className="muted">Никого не нашли.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted account-hint monitor-privacy">
            Здесь только количества и даты: названия досок, тексты карточек и сообщений не показываются.
          </p>
        </>
      )}
    </Modal>
  );
}
