// Images of a chat message: [{ id, name, type, size, width, height, original, preview }]. A compressed
// image is the file `id` itself; an original (`original` true) is shown by its smaller copy `preview`.

const FILE_ID = /^[0-9a-f-]{36}$/;
const MAX_IMAGES = 10;

const dimension = (v) => Number.isInteger(v) && v > 0 && v <= 100_000;

const image = (v) => v !== null && typeof v === 'object'
  && FILE_ID.test(v.id) && typeof v.name === 'string' && v.name.length <= 255
  && typeof v.type === 'string' && /^image\/[\w.+-]{1,100}$/.test(v.type)
  && Number.isInteger(v.size) && v.size >= 0 && dimension(v.width) && dimension(v.height)
  && typeof v.original === 'boolean' && (v.preview === null || FILE_ID.test(v.preview))
  && Object.keys(v).length === 8;

export const validImages = (v) => Array.isArray(v) && v.length <= MAX_IMAGES && v.every(image);

/** The file ids an image list keeps (originals and their previews). */
export const imageFileIds = (images) => (images ?? []).flatMap((i) => (i.preview ? [i.id, i.preview] : [i.id]));
