import { boardBackgroundCSSValue, CARD_COLORS } from '../appearance.js';

const columnCssColor = (id) => CARD_COLORS.find((c) => c.id === id)?.value ?? null;

const PLACEHOLDER_COUNTS = [2, 1, 1, 0, 0, 0];

/** Miniature board: columns, colours and background as on a real board. */
export default function TemplatePreview({ columns, background = null, className = '' }) {
  const cols = columns ?? [];
  const bg = boardBackgroundCSSValue(background);
  return (
    <div
      className={`template-preview ${className}`.trim()}
      aria-hidden="true"
    >
      <div
        className="template-preview-board"
        style={bg ? { background: bg } : undefined}
      >
        {cols.map((col, i) => {
          const tint = columnCssColor(col.color);
          const headStyle = tint ? { borderTopColor: tint } : undefined;
          const colStyle = tint ? { '--column-color': tint } : undefined;
          const n = PLACEHOLDER_COUNTS[i] ?? 1;
          return (
            <div
              key={`${col.name}-${i}`}
              className={`template-preview-col${tint ? ' template-preview-col-colored' : ''}`}
              style={colStyle}
            >
              <p className="template-preview-col-head" style={headStyle} title={col.name}>
                <span>{col.name}</span>
                {col.wipLimit ? <i className="template-preview-wip">{col.wipLimit}</i> : null}
              </p>
              {n > 0 && [...Array(n)].map((_, j) => (
                <div key={j} className="template-preview-card" />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
