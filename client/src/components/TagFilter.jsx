import CheckPicker from './CheckPicker.jsx';

/**
 * Picker of the tags to filter cards by: a card is shown when it has any of the `selected` tag keys.
 * `tags` ({ key, name, count }) are the tags of the cards in view and the selected ones.
 */
export default function TagFilter({ tags, selected, onToggle, onSetAll, onClear }) {
  return (
    <CheckPicker label="Теги" className="tag-filter" searchPlaceholder="Поиск тега"
      notFound="Тегов не найдено" clearLabel="Сбросить теги"
      items={tags.map((t) => ({ key: t.key, name: `#${t.name}`, count: t.count }))}
      selected={selected} onToggle={onToggle} onSetAll={onSetAll} onClear={selected.length ? onClear : null} />
  );
}
