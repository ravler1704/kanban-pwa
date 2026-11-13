/** Built-in board templates (always present in the gallery). */

export const BUILTIN_AUTHOR = '__builtin__';
export const BUILTIN_AUTHOR_NAME = 'Offline Kanban';

/** @type {Array<{ id: string, title: string, description: string, payload: object }>} */
export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-classic',
    title: 'Классический канбан',
    description: 'Три колонки для любых задач: что запланировано, что в работе и что уже готово.',
    payload: {
      setName: 'Классический канбан',
      columns: [
        { name: 'Запланировано', addToTop: true, wipLimit: null, color: null },
        { name: 'В работе', addToTop: false, wipLimit: 5, color: 'blue' },
        { name: 'Готово', addToTop: false, wipLimit: null, color: 'green' },
      ],
      doneMarks: true,
      background: 'ocean',
    },
  },
  {
    id: 'builtin-personal',
    title: 'Личные дела',
    description: 'Бэклог, фокус на сегодня и выполненное — удобно для домашних дел и привычек.',
    payload: {
      setName: 'Личные дела',
      columns: [
        { name: 'Надо', addToTop: true, wipLimit: null, color: null },
        { name: 'Сегодня', addToTop: false, wipLimit: 7, color: 'orange' },
        { name: 'Сделано', addToTop: false, wipLimit: null, color: 'green' },
      ],
      doneMarks: true,
      background: 'forest',
    },
  },
  {
    id: 'builtin-scrum',
    title: 'Scrum-спринт',
    description: 'Бэклог спринта, работа, проверка и готово — для небольшой команды разработки.',
    payload: {
      setName: 'Scrum',
      columns: [
        { name: 'Бэклог спринта', addToTop: true, wipLimit: null, color: null },
        { name: 'В работе', addToTop: false, wipLimit: 4, color: 'blue' },
        { name: 'На проверке', addToTop: false, wipLimit: 3, color: 'purple' },
        { name: 'Готово', addToTop: false, wipLimit: null, color: 'green' },
      ],
      doneMarks: true,
      background: 'dusk',
    },
  },
  {
    id: 'builtin-content',
    title: 'Контент и соцсети',
    description: 'От идеи до публикации: черновик, подготовка и выход в эфир.',
    payload: {
      setName: 'Контент',
      columns: [
        { name: 'Идеи', addToTop: true, wipLimit: null, color: null },
        { name: 'Черновик', addToTop: false, wipLimit: null, color: 'purple' },
        { name: 'На публикацию', addToTop: false, wipLimit: 5, color: 'orange' },
        { name: 'Опубликовано', addToTop: false, wipLimit: null, color: 'green' },
      ],
      doneMarks: true,
      background: 'sunset',
    },
  },
  {
    id: 'builtin-support',
    title: 'Поддержка и заявки',
    description: 'Входящие обращения: новые, в работе, ожидание ответа и закрытые.',
    payload: {
      setName: 'Поддержка',
      columns: [
        { name: 'Новые', addToTop: true, wipLimit: null, color: 'red' },
        { name: 'В работе', addToTop: false, wipLimit: 8, color: 'blue' },
        { name: 'Ожидание', addToTop: false, wipLimit: null, color: 'orange' },
        { name: 'Закрыто', addToTop: false, wipLimit: null, color: 'gray' },
      ],
      doneMarks: true,
      background: 'night',
    },
  },
  {
    id: 'builtin-hire',
    title: 'Найм',
    description: 'Воронка кандидатов: от отклика до оффера или отказа.',
    payload: {
      setName: 'Найм',
      columns: [
        { name: 'Кандидаты', addToTop: true, wipLimit: null, color: null },
        { name: 'Собеседование', addToTop: false, wipLimit: 6, color: 'teal' },
        { name: 'Оффер', addToTop: false, wipLimit: 3, color: 'purple' },
        { name: 'Решение', addToTop: false, wipLimit: null, color: 'green' },
      ],
      doneMarks: false,
      background: 'aurora',
    },
  },
];

export function seedBuiltinTemplates(db) {
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO board_templates (
      id, author_user_id, author_name, author_picture, title, description, payload,
      uses_count, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE board_templates SET title = ?, description = ?, payload = ?, updated_at = ?, author_name = ?
    WHERE id = ? AND author_user_id = ?
  `);
  for (const t of BUILTIN_TEMPLATES) {
    const body = JSON.stringify({
      setName: t.payload.setName,
      columns: t.payload.columns.map((c, i) => ({
        name: c.name,
        addToTop: !!c.addToTop,
        wipLimit: c.wipLimit ?? null,
        color: c.color ?? null,
        position: i + 1,
      })),
      doneMarks: t.payload.doneMarks ?? null,
      background: t.payload.background ?? null,
    });
    const row = db.prepare('SELECT author_user_id FROM board_templates WHERE id = ?').get(t.id);
    if (row) {
      if (row.author_user_id === BUILTIN_AUTHOR) {
        update.run(t.title, t.description, body, now, BUILTIN_AUTHOR_NAME, t.id, BUILTIN_AUTHOR);
      }
    } else {
      insert.run(t.id, BUILTIN_AUTHOR, BUILTIN_AUTHOR_NAME, t.title, t.description, body, now, now);
    }
  }
}
