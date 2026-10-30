import { useState, useSyncExternalStore } from 'react';
import { uploadStore } from '../files.js';
import Attachments from './Attachments.jsx';
import DescriptionField from './DescriptionField.jsx';
import ReminderField from './ReminderField.jsx';

/**
 * Description, reminder and (for an existing `card`) files: empty ones collapse into "add"
 * buttons sharing one row.
 */
export default function CardExtraFields({ description, onDescription, remindAt, onRemindAt, descriptionRows, card }) {
  const [descriptionOpen, setDescriptionOpen] = useState(Boolean(description));
  const [reminderOpen, setReminderOpen] = useState(Boolean(remindAt));
  const [filesOpen, setFilesOpen] = useState(false);
  const uploading = useSyncExternalStore(uploadStore.subscribe, uploadStore.get).some((u) => u.cardId === card?.id);
  const showDescription = descriptionOpen || Boolean(description);
  const showReminder = reminderOpen || Boolean(remindAt);
  const showFiles = !card || filesOpen || card.attachments?.length > 0 || uploading;

  return (
    <>
      {showDescription && (
        <DescriptionField
          value={description}
          onChange={onDescription}
          onCollapse={() => setDescriptionOpen(false)}
          rows={descriptionRows}
        />
      )}
      {showReminder && (
        <ReminderField value={remindAt} onChange={onRemindAt} onCollapse={() => setReminderOpen(false)} />
      )}
      {card && showFiles && (
        <Attachments card={card} pickOnOpen={filesOpen} onCollapse={() => setFilesOpen(false)} />
      )}
      {(!showDescription || !showReminder || !showFiles) && (
        <div className="field-adds">
          {!showDescription && (
            <button type="button" className="btn field-add" onClick={() => setDescriptionOpen(true)}>
              + Описание
            </button>
          )}
          {!showReminder && (
            <button type="button" className="btn field-add" onClick={() => setReminderOpen(true)}>
              + Напоминание
            </button>
          )}
          {!showFiles && (
            <button type="button" className="btn field-add" onClick={() => setFilesOpen(true)}>
              + Файлы
            </button>
          )}
        </div>
      )}
    </>
  );
}
