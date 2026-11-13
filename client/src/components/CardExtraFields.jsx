import { useState, useSyncExternalStore } from 'react';
import { uploadStore } from '../files.js';
import Attachments from './Attachments.jsx';
import CardDependencies from './CardDependencies.jsx';
import Checklist from './Checklist.jsx';
import DescriptionField from './DescriptionField.jsx';
import DeadlineField from './DeadlineField.jsx';
import ReminderField from './ReminderField.jsx';

/**
 * Description, reminder, deadline and (for an existing `card`) subtasks and files: empty ones collapse into "add"
 * buttons sharing one row.
 */
export default function CardExtraFields({
  description, onDescription, reminders, onReminders, dueAt, onDueAt, descriptionRows, card,
  cards, onOpenCard,
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(Boolean(description));
  const [reminderOpen, setReminderOpen] = useState(reminders.length > 0);
  const [deadlineOpen, setDeadlineOpen] = useState(dueAt != null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [depsOpen, setDepsOpen] = useState(false);
  const uploading = useSyncExternalStore(uploadStore.subscribe, uploadStore.get).some((u) => u.cardId === card?.id);
  const showDescription = descriptionOpen || Boolean(description);
  const showReminder = reminderOpen || reminders.length > 0;
  const showDeadline = deadlineOpen || dueAt != null;
  const showFiles = !card || filesOpen || card.attachments?.length > 0 || uploading;
  const showChecklist = !card || checklistOpen || card.checklist?.length > 0;
  const showDeps = Boolean(card && cards && (depsOpen || card.dependsOn?.length > 0));

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
        <ReminderField value={reminders} onChange={onReminders} onCollapse={() => setReminderOpen(false)} />
      )}
      {onDueAt && showDeadline && (
        <DeadlineField value={dueAt ?? null} onChange={onDueAt} onCollapse={() => setDeadlineOpen(false)} />
      )}
      {card && showChecklist && <Checklist card={card} onCollapse={() => setChecklistOpen(false)} />}
      {showDeps && (
        <CardDependencies card={card} cards={cards} onOpen={onOpenCard} onCollapse={() => setDepsOpen(false)} />
      )}
      {card && showFiles && (
        <Attachments card={card} pickOnOpen={filesOpen} onCollapse={() => setFilesOpen(false)} />
      )}
      {(!showDescription || !showReminder || !showDeadline || !showChecklist || !showFiles || (card && cards && !showDeps)) && (
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
          {onDueAt && !showDeadline && (
            <button type="button" className="btn field-add" onClick={() => setDeadlineOpen(true)}>
              + Дедлайн
            </button>
          )}
          {!showChecklist && (
            <button type="button" className="btn field-add" onClick={() => setChecklistOpen(true)}>
              + Подзадачи
            </button>
          )}
          {!showFiles && (
            <button type="button" className="btn field-add" onClick={() => setFilesOpen(true)}>
              + Файлы
            </button>
          )}
          {card && cards && !showDeps && (
            <button type="button" className="btn field-add" onClick={() => setDepsOpen(true)}>
              + Зависимости
            </button>
          )}
        </div>
      )}
    </>
  );
}
