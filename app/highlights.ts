// Finding and tidying the highlights for a photo. The model says roughly where
// each important phrase is; the code here then fits each mark to the actual
// printed line by looking at the pixels, the way a person lines a pen up with
// the words.

export type Box = { label: string; top: number; left: number; height: number; width: number };

// Each enlarged half covers this share of the photo's height (see toTiles).
const TILE = 0.56;

async function ask(image: string): Promise<Box[]> {
  const res = await fetch("/api/highlight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.boxes) ? body.boxes : [];
}

function overlapShare(a0: number, a1: number, b0: number, b1: number): number {
  const shared = Math.min(a1, b1) - Math.max(a0, b0);
  return shared <= 0 ? 0 : shared / Math.min(a1 - a0, b1 - b0);
}

// The two halves overlap in the middle, so the same phrase can come back twice.
function withoutRepeats(boxes: Box[]): Box[] {
  const kept: Box[] = [];
  for (const b of boxes) {
    const repeat = kept.some(
      (k) =>
        k.label === b.label &&
        overlapShare(k.top, k.top + k.height, b.top, b.top + b.height) > 0.5 &&
        overlapShare(k.left, k.left + k.width, b.left, b.left + b.width) > 0.5,
    );
    if (!repeat) kept.push(b);
  }
  return kept;
}

// Marks of the same kind that overlap or touch on one line become one stroke.
function joined(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of [...boxes].sort((x, y) => x.top - y.top || x.left - y.left)) {
    const mate = out.find(
      (k) =>
        k.label === b.label &&
        overlapShare(k.top, k.top + k.height, b.top, b.top + b.height) > 0.6 &&
        b.left <= k.left + k.width + 1.5 &&
        k.left <= b.left + b.width + 1.5,
    );
    if (!mate) {
      out.push({ ...b });
      continue;
    }
    const right = Math.max(mate.left + mate.width, b.left + b.width);
    const bottom = Math.max(mate.top + mate.height, b.top + b.height);
    mate.left = Math.min(mate.left, b.left);
    mate.top = Math.min(mate.top, b.top);
    mate.width = right - mate.left;
    mate.height = bottom - mate.top;
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Moves each box onto the line of print it is nearest to and trims it to whole
// words. A box in a blank or low-contrast patch is left as the model gave it.
async function snapToText(image: string, boxes: Box[]): Promise<Box[]> {
  const img = await loadImage(image);
  const W = Math.min(1400, img.naturalWidth);
  const H = Math.round((img.naturalHeight * W) / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const lum = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

  return boxes.map((box) => {
    const x0 = clamp((box.left / 100) * W, 0, W - 1);
    const x1 = clamp(((box.left + box.width) / 100) * W, x0 + 1, W);
    const y0 = clamp((box.top / 100) * H, 0, H - 1);
    const y1 = clamp(((box.top + box.height) / 100) * H, y0 + 1, H);
    const tall = y1 - y0;
    const sy0 = clamp(y0 - tall * 0.7, 0, H - 1);
    const sy1 = clamp(y1 + tall * 0.7, sy0 + 1, H);

    // What counts as ink here: clearly darker than this patch of paper.
    let sum = 0;
    let squares = 0;
    let n = 0;
    for (let y = sy0; y < sy1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = lum[y * W + x];
        sum += v;
        squares += v * v;
        n++;
      }
    }
    const mean = sum / n;
    const spread = Math.sqrt(Math.max(0, squares / n - mean * mean));
    if (spread < 10) return box;
    const limit = Math.min(mean - 0.5 * spread, mean - 15);
    const ink = (x: number, y: number) => lum[y * W + x] < limit;

    // Rows of print within reach of the box, grouped into lines.
    const lines: [number, number][] = [];
    let open = -1;
    for (let y = sy0; y <= sy1; y++) {
      let count = 0;
      if (y < sy1) for (let x = x0; x < x1; x++) if (ink(x, y)) count++;
      const printed = count / (x1 - x0) > 0.015;
      if (printed && open < 0) open = y;
      if (!printed && open >= 0) {
        lines.push([open, y]);
        open = -1;
      }
    }
    if (lines.length === 0) return box;
    const centre = (y0 + y1) / 2;
    const reach = (l: [number, number]) => Math.min(l[1], y1) - Math.max(l[0], y0);
    const line = lines.reduce((best, l) => {
      const better =
        reach(l) !== reach(best)
          ? reach(l) > reach(best)
          : Math.abs((l[0] + l[1]) / 2 - centre) < Math.abs((best[0] + best[1]) / 2 - centre);
      return better ? l : best;
    });
    const lineTall = line[1] - line[0];
    // Two lines run together, or a speck: do not trust it.
    if (lineTall < 4 || lineTall > tall * 2.2) return box;

    // Columns of print along that line. Grow each end to finish the word it
    // cuts through, then pull it in to the first and last letter.
    // Wider than the space between letters, narrower than the space between words.
    const gap = Math.max(2, Math.round(lineTall * 0.2));
    const column = (x: number) => {
      if (x < 0 || x >= W) return false;
      for (let y = line[0]; y < line[1]; y++) if (ink(x, y)) return true;
      return false;
    };
    const near = (from: number, to: number) => {
      for (let x = from; x < to; x++) if (column(x)) return true;
      return false;
    };
    const limitLeft = clamp(x0 - W * 0.06, 0, W);
    const limitRight = clamp(x1 + W * 0.06, 0, W);
    let left = x0;
    let right = x1;
    while (left > limitLeft && near(left - gap, left)) left--;
    while (right < limitRight && near(right, right + gap)) right++;
    while (left < right - 1 && !column(left)) left++;
    while (right > left + 1 && !column(right - 1)) right--;
    if (right - left < 4) return box;

    const pad = Math.max(1, Math.round(lineTall * 0.12));
    const top = Math.max(0, line[0] - pad);
    const bottom = Math.min(H, line[1] + pad);
    return {
      label: box.label,
      top: (top / H) * 100,
      height: ((bottom - top) / H) * 100,
      left: (Math.max(0, left - pad) / W) * 100,
      width: ((Math.min(W, right + pad) - Math.max(0, left - pad)) / W) * 100,
    };
  });
}

// `tiles` are the enlarged top and bottom halves of the same photo. The model
// sees each image at a fixed size, so asking about the halves separately gives
// it twice the detail to place its marks with.
export async function findHighlights(image: string, tiles: string[]): Promise<Box[]> {
  let boxes: Box[];
  if (tiles.length === 2) {
    const [upper, lower] = await Promise.all(tiles.map(ask));
    const place = (b: Box, offset: number): Box => ({
      ...b,
      top: offset + b.top * TILE,
      height: b.height * TILE,
    });
    boxes = withoutRepeats([
      ...upper.map((b) => place(b, 0)),
      ...lower.map((b) => place(b, (1 - TILE) * 100)),
    ]);
  } else {
    boxes = await ask(image);
  }
  try {
    return joined(await snapToText(image, boxes));
  } catch {
    return boxes;
  }
}
