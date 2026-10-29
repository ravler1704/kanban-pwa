/** Expanded description; `onCollapse` is called when it loses focus while empty. */
export default function DescriptionField({ value, onChange, onCollapse, rows = 6 }) {
  return (
    <label>
      Описание
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => !value && onCollapse()}
        rows={rows}
        maxLength={10000}
        autoFocus={!value}
      />
    </label>
  );
}
