import { boardHeaders, boardQuery } from './board.js';

// Images in chats, sent as in Telegram: compressed by default (the long side shrunk, saved as JPEG), or the
// original file with a compressed copy to show in the chat. Uploaded before the message is written, so
// attaching needs a connection. An image: { id, name, type, size, width, height, original, preview }.

const COMPRESSED_SIDE = 1920;
const PREVIEW_SIDE = 1280;
const QUALITY = 0.82;
const COMPRESS_KEY = 'chatImagesCompress';

/** Whether to compress, as last chosen on this device (on by default). */
export const compressByDefault = () => localStorage.getItem(COMPRESS_KEY) !== '0';
export const rememberCompress = (on) => localStorage.setItem(COMPRESS_KEY, on ? '1' : '0');

export const isImageFile = (file) => /^image\//.test(file.type);

export const chatImageUrl = (id, { download = false } = {}) => {
  const query = boardQuery();
  return `/api/chat-images/${id}${query}${download ? `${query ? '&' : '?'}download` : ''}`;
};

/** The file to show in the chat: the compressed image itself, or the original's preview. */
export const shownId = (image) => image.preview ?? image.id;

const jpegName = (name) => `${name.replace(/\.[^.]+$/, '') || 'image'}.jpg`;

/** The picture shrunk to `side` pixels along the long side, as JPEG (transparency on white). */
async function shrink(bitmap, side) {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
}

const ERRORS = {
  403: 'Здесь можно только смотреть.',
  413: 'Картинка больше 50 МБ.',
  415: 'Это не картинка.',
  507: 'На сервере закончилось место.',
};

function upload(blob, name, type, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/chat-images?${new URLSearchParams({ name, type })}`);
    for (const [key, value] of Object.entries(boardHeaders())) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(ERRORS[xhr.status] ?? `Не удалось загрузить «${name}» (ошибка ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Картинку можно отправить только при связи с сервером.'));
    xhr.send(blob);
  });
}

/**
 * Prepares and uploads the picture: compressed, or (`compress` false) the original and its preview.
 * GIFs go as they are, so they stay animated. `onProgress` gets 0…1.
 */
export async function uploadChatImage(file, { compress, onProgress }) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`«${file.name}» — не картинка или её формат не поддерживается.`);
  }
  const { width, height } = bitmap;
  try {
    const keep = file.type === 'image/gif';
    if (compress && !keep) {
      const blob = await shrink(bitmap, COMPRESSED_SIDE);
      const scale = Math.min(1, COMPRESSED_SIDE / Math.max(width, height));
      const name = jpegName(file.name);
      const { id, size } = await upload(blob, name, 'image/jpeg', onProgress);
      return {
        id, name, type: 'image/jpeg', size, width: Math.round(width * scale), height: Math.round(height * scale),
        original: false, preview: null,
      };
    }
    // The preview goes first: it is small, and the original's progress is what the user waits for.
    const preview = keep ? null : await upload(await shrink(bitmap, PREVIEW_SIDE), jpegName(file.name), 'image/jpeg');
    const { id, size } = await upload(file, file.name || 'image', file.type, onProgress);
    return {
      id, name: file.name || 'image', type: file.type, size, width, height, original: !compress, preview: preview?.id ?? null,
    };
  } finally {
    bitmap.close();
  }
}
