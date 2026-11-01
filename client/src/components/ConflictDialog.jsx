import { useState } from 'react';
import { resolveConflict } from '../actions.js';
import { withoutLinks } from '../links.js';
import Modal from './Modal.jsx';

const LABELS = { title: 'Название', description: 'Описание' };

function DeletedConflict({ card, onClose }) {
  const { mine } = card.conflict.fields.deleted;

  async function resolve(resolution) {
    await resolveConflict(card.id, resolution);
    onClose();
  }

  if (mine) {
    return (
      <Modal title="Конфликт удаления" onClose={onClose}>
        <p>Вы удалили карточку «{withoutLinks(card.title)}», но на другом устройстве её успели изменить.</p>
        <div className="actions">
          <button className="btn" onClick={() => resolve({})}>Оставить карточку</button>
          <button className="btn btn-danger" onClick={() => resolve({ deleted: true })}>Всё равно удалить</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Конфликт удаления" onClose={onClose}>
      <p>
        Вы изменили карточку «{withoutLinks(card.conflict.local.title)}», но на другом устройстве её удалили.
      </p>
      <div className="actions">
        <button className="btn" onClick={() => resolve({})}>Согласиться с удалением</button>
        <button className="btn btn-primary" onClick={() => resolve({ ...card.conflict.local, deleted: false })}>
          Восстановить с моими правками
        </button>
      </div>
    </Modal>
  );
}

function FieldConflict({ card, onClose }) {
  const fields = Object.keys(card.conflict.fields);
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f, card.conflict.fields[f].mine])),
  );

  async function save() {
    await resolveConflict(card.id, values);
    onClose();
  }

  return (
    <Modal title="Конфликт правок" onClose={onClose}>
      <p className="muted">
        Карточку одновременно изменили на этом и на другом устройстве. Выберите версию для каждого
        поля или отредактируйте итоговый текст вручную.
      </p>
      {fields.map((f) => {
        const { mine, theirs } = card.conflict.fields[f];
        const Input = f === 'description' ? 'textarea' : 'input';
        return (
          <div key={f} className="conflict-field">
            <h4>{LABELS[f] ?? f}</h4>
            <div className="conflict-versions">
              <button
                className={`version ${values[f] === mine ? 'version-selected' : ''}`}
                onClick={() => setValues((v) => ({ ...v, [f]: mine }))}
              >
                <span className="version-label">Моя версия</span>
                <span className="version-text">{mine || '—'}</span>
              </button>
              <button
                className={`version ${values[f] === theirs ? 'version-selected' : ''}`}
                onClick={() => setValues((v) => ({ ...v, [f]: theirs }))}
              >
                <span className="version-label">С другого устройства</span>
                <span className="version-text">{theirs || '—'}</span>
              </button>
            </div>
            <label className="field">
              <span className="field-label">Итог</span>
              <Input
                value={values[f]}
                rows={4}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              />
            </label>
          </div>
        );
      })}
      <div className="actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Позже</button>
        <button className="btn btn-primary" onClick={save}>Сохранить</button>
      </div>
    </Modal>
  );
}

export default function ConflictDialog({ card, onClose }) {
  return card.conflict.fields.deleted
    ? <DeletedConflict card={card} onClose={onClose} />
    : <FieldConflict card={card} onClose={onClose} />;
}
