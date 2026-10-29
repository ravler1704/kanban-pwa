import { useEffect, useState, useSyncExternalStore } from 'react';
import { authState, getMembers, inviteMember, leaveCurrentBoard, removeMember } from '../auth.js';
import { boardName, currentBoard } from '../board.js';
import { syncStatus } from '../sync.js';

/** Who else sees the own board; on someone else's board, leaving it. */
export default function SharingSection() {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!online) return;
    getMembers().then(setMembers, (err) => setError(err.message));
  }, [online]);

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

  async function invite(e) {
    e.preventDefault();
    await run(async () => {
      setMembers(await inviteMember(email.trim()));
      setEmail('');
    });
  }

  async function remove(member) {
    if (!confirm(`Закрыть доступ к вашей доске для ${member.email}?`)) return;
    await run(async () => setMembers(await removeMember(member.email)));
  }

  async function leave() {
    if (!confirm('Покинуть эту доску? Вернуться можно будет, только если владелец пригласит вас снова.')) return;
    await run(leaveCurrentBoard);
  }

  const shared = currentBoard && user?.boards?.find((b) => b.id === currentBoard);

  return (
    <>
      {currentBoard && (
        <>
          <h4 className="manage-heading">Эта доска</h4>
          <div className="manage-row account-row">
            <span className="account-email">{shared ? boardName(shared) : 'Общая доска'}</span>
            <button className="btn btn-small btn-danger" disabled={busy || !online} onClick={leave}>Покинуть</button>
          </div>
        </>
      )}
      <h4 className="manage-heading">Доступ к моей доске</h4>
      <p className="muted account-hint">
        Приглашённые видят и редактируют все проекты и карточки вашей доски. Пусть войдут через Google
        или Яндекс с этим адресом почты — доска появится у них в списке вверху экрана.
      </p>
      {!online && <p className="muted">Для управления доступом нужен интернет.</p>}
      {online && members?.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <span className="account-email" title={m.email}>
            {m.name ? `${m.name} · ${m.email}` : m.email}
            {!m.joined && <span className="muted"> — ещё не входил</span>}
          </span>
          <button className="btn btn-small" disabled={busy} onClick={() => remove(m)}>Убрать</button>
        </div>
      ))}
      {online && (
        <form className="manage-add" onSubmit={invite}>
          <label className="field manage-field">
            <span className="field-label">Почта участника</span>
            <input className="manage-input" type="email" value={email} maxLength={254} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-small" disabled={busy || !email.trim()}>Пригласить</button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </>
  );
}
