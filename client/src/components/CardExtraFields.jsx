import { useState } from 'react';
import DescriptionField from './DescriptionField.jsx';
import ReminderField from './ReminderField.jsx';

/** Description and reminder: empty ones collapse into "add" buttons sharing one row. */
export default function CardExtraFields({ description, onDescription, remindAt, onRemindAt, descriptionRows }) {
  const [descriptionOpen, setDescriptionOpen] = useState(Boolean(description));
  const [reminderOpen, setReminderOpen] = useState(Boolean(remindAt));
  const showDescription = descriptionOpen || Boolean(description);
  const showReminder = reminderOpen || Boolean(remindAt);

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
      {(!showDescription || !showReminder) && (
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
        </div>
      )}
    </>
  );
}
