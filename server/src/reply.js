// What a chat message answers: { id, author, text, quote } — the id of the message, its author's name and
// its text as they were when answering (the original may change or go). `quote`: `text` is a fragment the
// user selected, not the whole message.

export const MAX_REPLY_TEXT = 1000;

export const validReply = (v) => v === null || (v !== null && typeof v === 'object'
  && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 64
  && typeof v.author === 'string' && v.author.length <= 200
  && typeof v.text === 'string' && v.text.length <= MAX_REPLY_TEXT
  && typeof v.quote === 'boolean'
  && Object.keys(v).length === 4);
