// What changed between two versions of a text, compact enough for a note in the chat:
// [[op, text], ...] with op 0 (kept, shortened to the words around changes), -1 (removed), 1 (added).

// Above this many word pairs the changed middle is shown as replaced whole.
const MAX_CELLS = 1_000_000;
const CONTEXT = 40;

const words = (text) => text.split(/(\s+)/).filter(Boolean);

/** Word-level diff of `a` and `b` by the longest common subsequence: [[op, text], ...]. */
function wordDiff(a, b) {
  const x = words(a);
  const y = words(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) { endX--; endY--; }

  const ops = [];
  const push = (op, text) => {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last[0] === op) last[1] += text;
    else ops.push([op, text]);
  };
  push(0, x.slice(0, start).join(''));
  const midX = x.slice(start, endX);
  const midY = y.slice(start, endY);
  const n = midX.length;
  const m = midY.length;
  if (n * m > MAX_CELLS) {
    push(-1, midX.join(''));
    push(1, midY.join(''));
  } else {
    // lcs[i * (m + 1) + j]: common length of midX[i..] and midY[j..].
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] = midX[i] === midY[j]
          ? lcs[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midX[i] === midY[j]) { push(0, midX[i]); i++; j++; }
      else if (i < n && (j === m || lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) push(-1, midX[i++]);
      else push(1, midY[j++]);
    }
  }
  push(0, x.slice(endX).join(''));
  return ops;
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// About CONTEXT characters from the start or the end of the text, in whole words.
const head = (text) => text.slice(0, CONTEXT).replace(/\S*$/, '');
const tail = (text) => text.slice(-CONTEXT).replace(/^\S*/, '');

/** Kept text only around the changes; changes cut to `maxChange` characters each. */
function shorten(ops, maxChange) {
  return ops.map(([op, text], i) => {
    if (op !== 0) return [op, cut(text, maxChange)];
    const first = i === 0;
    const last = i === ops.length - 1;
    if (first && !last) return [op, text.length > CONTEXT ? `…${tail(text)}` : text];
    if (last && !first) return [op, text.length > CONTEXT ? `${head(text)}…` : text];
    return [op, text.length > 2 * CONTEXT ? `${head(text)}…${tail(text)}` : text];
  });
}

/** The diff of `before` → `after` whose JSON fits `maxLength`, or null if none does. */
export function textDiff(before, after, maxLength) {
  const ops = wordDiff(before ?? '', after ?? '');
  if (!ops.some(([op]) => op !== 0)) return null;
  for (const maxChange of [1000, 400, 150, 50]) {
    const diff = shorten(ops, maxChange);
    if (JSON.stringify(diff).length <= maxLength) return diff;
  }
  return null;
}
