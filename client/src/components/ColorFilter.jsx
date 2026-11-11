import { DialogField, FilterActions, FilterSheet, SwitchRow } from './FolderFilter.jsx';

const cardsCount = (n) => {
  const one = n % 10 === 1 && n % 100 !== 11;
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20);
  return `${n} ${one ? 'карточка' : few ? 'карточки' : 'карточек'}`;
};

function ColorFilterDialog({ colors, selected, onToggle, onClear, onClose }) {
  return (
    <FilterSheet title="Цвет карточки" onClose={onClose}>
      <ul className="fp-list ff-group">
        <SwitchRow strong label="Все карточки" on={selected.length === 0}
          meta={selected.length ? 'Сейчас: только выбранные цвета' : 'Или включите нужные цвета ниже'}
          onChange={(v) => v && onClear()} />
      </ul>
      <ul className="fp-list ff-list">
        {colors.map((c) => (
          <SwitchRow key={c.id}
            label={(
              <span className="ff-color">
                {c.value
                  ? <span className="ff-color-swatch" style={{ background: c.value }} aria-hidden="true" />
                  : <span className="ff-color-swatch ff-color-swatch-none" aria-hidden="true" />}
                {c.name}
              </span>
            )}
            meta={cardsCount(c.count)}
            on={selected.includes(c.id)} onChange={() => onToggle(c.id)} />
        ))}
      </ul>
      <FilterActions onClose={onClose} />
    </FilterSheet>
  );
}

/**
 * Cards by cover colour: a card is shown when its colour is among `selected` (empty: all cards).
 * `colors` — { id, name, value, count } for colours present in view and any still selected.
 */
export default function ColorFilter({ colors, selected, onToggle, onClear }) {
  const nameOf = (id) => colors.find((c) => c.id === id)?.name ?? id;
  const value = selected.length ? selected.map(nameOf).join(', ') : 'Все карточки';
  return (
    <DialogField label="Цвет" value={value}
      dialog={(onClose) => (
        <ColorFilterDialog colors={colors} selected={selected} onToggle={onToggle} onClear={onClear} onClose={onClose} />
      )} />
  );
}
