import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadPublicLinks, publicUrl, removePublicLink, savePublicLink, usePublicLinks } from '../public.js';
import { syncStatus } from '../sync.js';

/** «Публичная ссылка» in the settings of a folder of the own board. */
export default function PublicLinkSettings({ folder }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const links = usePublicLinks();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = links?.find((l) => l.project === folder.id);

  useEffect(() => {
    if (!online) return;
    loadPublicLinks().catch((err) => setError(err.message));
  }, [online]);

  async function change(mode) {
    if (mode === 'off' && !confirm('Ссылка перестанет работать. Если включить её снова, будет новая ссылка. Выключить?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (mode === 'off' ? removePublicLink(folder.id) : savePublicLink(folder.id, mode));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl(link.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не удалось скопировать — выделите ссылку и скопируйте вручную.');
    }
  }

  return (
    <div className="manage-sections">
      <h4 className="manage-heading">Публичная ссылка</h4>
      {!online && <p className="muted">Для управления ссылкой нужен интернет.</p>}
      {online && links && (
        <>
          <label className="field">
            <span className="field-label">Доступ по ссылке</span>
            <select className="select" value={link?.mode ?? 'off'} disabled={busy} onChange={(e) => change(e.target.value)}>
              <option value="off">Выключен</option>
              <option value="view">Только просмотр</option>
              <option value="edit">Просмотр и редактирование карточек</option>
            </select>
          </label>
          {link && (
            <>
              <div className="manage-row">
                <input className="manage-input public-url" readOnly value={publicUrl(link.token)} aria-label="Ссылка"
                  onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-small" onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</button>
              </div>
              <p className="muted account-hint">
                Любой, у кого есть ссылка, откроет эту папку со всем, что в ней, без входа
                {link.mode === 'edit' ? ' и сможет менять карточки и вложенные папки.' : ', но ничего не сможет изменить.'}
              </p>
            </>
          )}
        </>
      )}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
