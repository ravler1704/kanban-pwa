import { useState } from 'react';

/** Description textarea: one line while empty and not focused, expanded otherwise. */
export default function DescriptionField({ value, onChange, rows = 6 }) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || value.length > 0;
  return (
    <label>
      Описание
      <textarea
        className={expanded ? undefined : 'textarea-collapsed'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={expanded ? rows : 1}
        maxLength={10000}
      />
    </label>
  );
}
