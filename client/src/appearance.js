import { setColumnColor, setFolderBackground, updateCard } from './actions.js';
import { backgroundUrl, isUploadedBackground, uploadBackground } from './files.js';
import { folderPath } from './folders.js';

/** Cover colours of cards (as in Trello); the same in both themes. */
export const CARD_COLORS = [
  { id: 'green', name: 'Зелёный', value: '#4bce97' },
  { id: 'yellow', name: 'Жёлтый', value: '#f5cd47' },
  { id: 'orange', name: 'Оранжевый', value: '#fea362' },
  { id: 'red', name: 'Красный', value: '#f87168' },
  { id: 'purple', name: 'Фиолетовый', value: '#9f8fef' },
  { id: 'blue', name: 'Синий', value: '#579dff' },
  { id: 'sky', name: 'Голубой', value: '#6cc3e0' },
  { id: 'lime', name: 'Салатовый', value: '#94c748' },
  { id: 'pink', name: 'Розовый', value: '#e774bb' },
  { id: 'gray', name: 'Серый', value: '#8590a2' },
];

const UPLOAD_ICON = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12';

// A picture covering the board; the colour shows while it loads.
const picture = (url) => `url("${url}") center / cover no-repeat, #1e293b`;

/** Board backgrounds: plain colours, gradients and pictures, dark enough for light text over them. */
export const BOARD_BACKGROUNDS = [
  { id: 'blue', name: 'Синий', value: '#1d4ed8' },
  { id: 'green', name: 'Зелёный', value: '#15803d' },
  { id: 'orange', name: 'Оранжевый', value: '#c2410c' },
  { id: 'red', name: 'Красный', value: '#b91c1c' },
  { id: 'purple', name: 'Фиолетовый', value: '#6d28d9' },
  { id: 'pink', name: 'Розовый', value: '#be185d' },
  { id: 'teal', name: 'Бирюзовый', value: '#0f766e' },
  { id: 'gray', name: 'Серый', value: '#475569' },
  { id: 'ocean', name: 'Океан', value: 'linear-gradient(135deg, #0c66e4, #09326c)' },
  { id: 'sunset', name: 'Закат', value: 'linear-gradient(135deg, #f97316, #be185d)' },
  { id: 'forest', name: 'Лес', value: 'linear-gradient(135deg, #16a34a, #0f3d2e)' },
  { id: 'dusk', name: 'Сумерки', value: 'linear-gradient(135deg, #7c3aed, #312e81)' },
  { id: 'candy', name: 'Конфета', value: 'linear-gradient(135deg, #ec4899, #8b5cf6)' },
  { id: 'aurora', name: 'Сияние', value: 'linear-gradient(135deg, #0891b2, #16a34a)' },
  { id: 'night', name: 'Ночь', value: 'linear-gradient(135deg, #1e293b, #020617)' },
];

/** Pictures shipped with the app (public/backgrounds). */
export const BOARD_PICTURES = [
  { id: 'img-mountains', name: 'Горы', value: picture('/backgrounds/mountains.jpg') },
  { id: 'img-forest', name: 'Туманный лес', value: picture('/backgrounds/forest.jpg') },
  { id: 'img-sea', name: 'Море', value: picture('/backgrounds/sea.jpg') },
  { id: 'img-stars', name: 'Звёзды', value: picture('/backgrounds/stars.jpg') },
  { id: 'img-lake', name: 'Озеро', value: picture('/backgrounds/lake.jpg') },
  { id: 'img-waves', name: 'Волны', value: picture('/backgrounds/waves.jpg') },
];

export const cardColor = (card) => CARD_COLORS.find((c) => c.id === card.color)?.value ?? null;
export const columnColor = (column) => CARD_COLORS.find((c) => c.id === column.color)?.value ?? null;

/** The CSS background of a folder's `background` (a preset or an uploaded picture), null for none. */
function backgroundValue(id) {
  if (isUploadedBackground(id)) return picture(backgroundUrl(id));
  return [...BOARD_BACKGROUNDS, ...BOARD_PICTURES].find((b) => b.id === id)?.value ?? null;
}

/** CSS `background` value for board preview (template id or null → panel default). */
export function boardBackgroundCSSValue(id) {
  return id ? backgroundValue(id) : null;
}

/** The board's background: the folder's own or the nearest ancestor's ('none' stops it). */
export function folderBackground(folder, folders) {
  const path = folderPath(folder, folders);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const id = path[i].background;
    if (id) return backgroundValue(id);
  }
  return null;
}

/** Whether the folder's cards can be marked done: its own setting, the nearest ancestor's or the space's. */
export function folderDoneMarks(folder, folders, spaceDoneMarks = true) {
  const path = folderPath(folder, folders);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (typeof path[i].doneMarks === 'boolean') return path[i].doneMarks;
  }
  return spaceDoneMarks;
}

/** Menu items (see ContextMenu) that set the card's cover colour. */
export const cardColorItems = (card) => [
  { label: 'Без цвета', swatch: 'none', active: !card.color, run: () => updateCard(card.id, { color: null }) },
  null,
  ...CARD_COLORS.map((c) => ({
    label: c.name, swatch: c.value, active: card.color === c.id, run: () => updateCard(card.id, { color: c.id }),
  })),
];

/** Menu items that tint the column. */
export const columnColorItems = (column) => [
  { label: 'Без цвета', swatch: 'none', active: !column.color, run: () => setColumnColor(column.id, null) },
  null,
  ...CARD_COLORS.map((c) => ({
    label: c.name, swatch: c.value, active: column.color === c.id, run: () => setColumnColor(column.id, c.id),
  })),
];

/** Asks for a picture and makes it the folder's background. */
function pickPicture(folderId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    uploadBackground(file)
      .then((background) => setFolderBackground(folderId, background))
      .catch((err) => alert(err.message));
  });
  input.click();
}

/** Menu items that set the folder's background; a folder inside another may take the parent's. */
export function backgroundItems(folder) {
  const own = folder.background ?? null;
  const item = (b) => ({
    label: b.name, swatch: b.value, active: own === b.id, run: () => setFolderBackground(folder.id, b.id),
  });
  return [
    ...(folder.parentId
      ? [{ label: 'Как у родительской', active: own === null, run: () => setFolderBackground(folder.id, null) }]
      : []),
    {
      label: 'Без фона', swatch: 'none', active: folder.parentId ? own === 'none' : !own || own === 'none',
      run: () => setFolderBackground(folder.id, folder.parentId ? 'none' : null),
    },
    null,
    ...BOARD_BACKGROUNDS.map(item),
    null,
    ...BOARD_PICTURES.map(item),
    null,
    ...(isUploadedBackground(own) ? [{ label: 'Своя картинка', swatch: backgroundValue(own), active: true, run: () => {} }] : []),
    { label: 'Загрузить картинку…', icon: UPLOAD_ICON, run: () => pickPicture(folder.id) },
  ];
}
