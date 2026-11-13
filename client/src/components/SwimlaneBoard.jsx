import Column from './Column.jsx';
import { buildSwimlanes, cardLaneId } from '../swimlanes.js';

/**
 * The kanban board with horizontal swimlanes: each row is a group, columns are workflow stages.
 * Dragging a card into another lane updates assignee, board or colour (see swimlanes.js).
 */
export default function SwimlaneBoard({
  mode, cards, lanes: lanesCtx, columns, collapsed: collapsedList, cardById, columnProps,
}) {
  const lanes = buildSwimlanes(cards, mode, lanesCtx);
  const tracks = columns.map((c) => (collapsedList.includes(c.id) ? 'var(--column-collapsed)' : 'var(--column-width)')).join(' ');

  const swimlanePatch = { mode, cardById };

  return (
    <main className="board-swimlanes">
      {lanes.map((lane) => (
        <section key={lane.id} className="swimlane-row">
          <section className="swimlane-label" title={lane.label}>
            {lane.color && <span className="swimlane-swatch" style={{ background: lane.color }} aria-hidden="true" />}
            <span className="swimlane-label-name">
              <span className="swimlane-name">{lane.label}</span>
              <span className="count">{lane.count}</span>
            </span>
          </section>
          <div className="swimlane-cols board" style={{ '--tracks': tracks }}>
            {columns.map((col, colIndex) => (
              <Column
                key={`${lane.id}:${col.id}`}
                {...columnProps}
                column={col}
                prevColumn={columns[colIndex - 1]}
                nextColumn={columns[colIndex + 1]}
                showHead={false}
                collapsed={collapsedList.includes(col.id)}
                onToggleCollapsed={() => columnProps.onToggleCollapsed(col.id)}
                onCollapseOthers={() => columnProps.onCollapseOthers(col)}
                onNewCard={() => columnProps.onNewCard(col)}
                swimlane={{ laneId: lane.id, ...swimlanePatch }}
                cards={cards.filter((c) => c.columnId === col.id && cardLaneId(c, mode) === lane.id)}
              />
            ))}
          </div>
        </section>
      ))}
      {columns.length === 0 && <p className="empty">Нет колонок для отображения дорожек.</p>}
      {columns.length > 0 && lanes.length === 0 && <p className="empty">Нет карточек для дорожек.</p>}
    </main>
  );
}