import { useEffect, useState } from 'react';
import { authState } from '../auth.js';
import { applyBoardTemplate, createBoardFromTemplate } from '../templateApply.js';
import { deleteTemplate, listTemplates, noteTemplateUse } from '../templatesApi.js';
import Modal from './Modal.jsx';
import { SearchField } from './FolderFilter.jsx';

function Author({ author }) {
  return (
    <span className="template-author" title="Автор шаблона">
      {author.picture && (
        <img className="template-author-photo" src={author.picture} alt="" width={22} height={22} />
      )}
      <span>{author.name || 'Автор'}</span>
    </span>
  );
}

function TemplateCard({ item, canDelete, canCreateBoard, onApply, onDelete }) {
  const cols = item.payload.columns.map((c) => c.name).join(' · ');
  return (
    <article className="template-card">
      <h3 className="template-card-title">{item.title}</h3>
      {item.description && <p className="template-card-desc">{item.description}</p>}
      <p className="template-card-cols muted">{item.payload.setName}: {cols}</p>
      <div className="template-card-meta">
        <Author author={item.author} />
        <span className="muted">использований: {item.usesCount}</span>
      </div>
      <div className="template-card-actions">
        <button type="button" className="btn btn-primary btn-small" onClick={() => onApply(item)}>
          {canCreateBoard ? 'Создать доску' : 'Применить'}
        </button>
        {canDelete && (
          <button type="button" className="btn btn-small" onClick={() => onDelete(item)}>Удалить</button>
        )}
      </div>
    </article>
  );
}

/**
 * Public showcase of board templates. `folder` — optional board to assign the chosen set to.
 */
export default function TemplatesGallery({ folder, readOnly, onClose }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const me = authState.get().user?.id;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const mine = tab === 'mine';
    listTemplates({ q: query, mine })
      .then((data) => { if (!cancel) setItems(data.templates ?? []); })
      .catch((e) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [tab, query]);

  async function apply(item) {
    if (readOnly) return;
    setBusy(item.id);
    try {
      let folderId = folder?.id ?? null;
      if (folder) {
        await applyBoardTemplate(item.payload, {
          folderId,
          applyBoardOptions: true,
        });
      } else {
        ({ folderId } = await createBoardFromTemplate(item.payload, { boardName: item.title }));
      }
      noteTemplateUse(item.id).catch(() => {});
      onClose({ folderId });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(item) {
    if (!confirm(`Удалить шаблон «${item.title}»?`)) return;
    try {
      await deleteTemplate(item.id);
      setItems((list) => list.filter((t) => t.id !== item.id));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <Modal title="Витрина шаблонов" onClose={() => onClose(false)} className="templates-gallery" closeButton>
      <p className="muted template-lead">
        Готовые наборы колонок от других пользователей. У каждого шаблона указан автор.
        {folder
          ? ` Новый набор можно сразу назначить доске «${folder.name}».`
          : ' По кнопке «Создать доску» в вашем пространстве появится новая доска с колонками из шаблона.'}
      </p>
      <div className="template-tabs" role="tablist">
        <button type="button" role="tab" className={tab === 'all' ? 'template-tab-on' : ''}
          aria-selected={tab === 'all'} onClick={() => setTab('all')}>Все</button>
        <button type="button" role="tab" className={tab === 'mine' ? 'template-tab-on' : ''}
          aria-selected={tab === 'mine'} onClick={() => setTab('mine')} disabled={!me}
          title={me ? undefined : 'Войдите, чтобы видеть свои публикации'}>Мои</button>
      </div>
      <SearchField placeholder="Поиск по названию или автору" value={query} onChange={setQuery} />
      {loading && <p className="muted">Загрузка…</p>}
      {error && <p className="login-error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted">Пока нет шаблонов{tab === 'mine' ? ' от вас' : ''}.</p>
      )}
      <div className="template-grid">
        {items.map((item) => (
          <TemplateCard key={item.id} item={item}
            canCreateBoard={!folder}
            canDelete={me && item.author.id === me}
            onApply={apply}
            onDelete={remove} />
        ))}
      </div>
      {busy && <p className="muted">Применяем шаблон…</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => onClose(false)}>Закрыть</button>
      </div>
    </Modal>
  );
}
