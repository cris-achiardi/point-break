/**
 * Pixel-art control sprites, lifted out of the Figma file ("Point Break" / page "mobile controls")
 * and stored as text rather than shipped as PNGs.
 *
 * WHY TEXT AND NOT IMAGE FILES. The art was drawn on a 4px block grid and then rescaled, which
 * left every sprite sitting on a fractional block: 9.231px for the large scale (120/13) and
 * 6.615px for the small one (86/13). That number is poison for both obvious export routes. As
 * SVG, one <rect> per block at fractional coordinates means the browser antialiases every block
 * boundary, so you get hairline seams and soft edges — and this is the one layer that must stay
 * hard, because the world behind it is rendered through a 320x240 posterise pass. As a PNG
 * exported at the Figma size you bake that same fractional grid into the pixels.
 *
 * The grids themselves, though, are exact: every sprite is a whole number of blocks (13 wide,
 * 11 for the thumb hole) and every block offset is an exact multiple. So the art is intact and
 * only the frame scale was fractional. Storing the grid and rasterising it here at ONE PIXEL PER
 * BLOCK sidesteps the whole problem: the PNG is the art at its true resolution, and CSS blows it
 * back up with image-rendering: pixelated. It also keeps the sprites diffable in git, and
 * re-extractable from Figma without an export step or an API token.
 *
 * THE PALETTE IS A LADDER, in order, darkest first. This is not decoration — a pressed button is
 * the same art shifted exactly one rung down it (highlight becomes face, face becomes shadow,
 * shadow becomes the deepest shadow, and the bright icon dims), plus one lost row of skirt. Both
 * states are stored verbatim anyway, because the drawn art is the authority and a couple of the
 * pressed sprites differ from a pure shift by a pixel or two.
 */

const PAL = {
  1: '#131313',   // hard outline
  2: '#1a1932',   // deepest shadow: the pressed skirt, and the well of the thumb hole
  3: '#2a2f4e',   // shadow / the face of a pressed button
  4: '#424c6e',   // face / the bevel of a pressed button
  5: '#657392',   // lit bevel
  6: '#94b8ab',   // icon, pressed
  7: '#cef0e4',   // icon
};

/*
 * '.' is transparent. Everything else indexes PAL.
 *
 * The three action buttons share one body outright — comp, pump and brake are byte-identical
 * apart from the five-block-wide icon in the middle — and the pill's end caps are the same caps
 * again. That redundancy is left in on purpose: this table is a faithful dump of what was drawn,
 * so it can be regenerated wholesale from Figma without anyone having to reason about which
 * sprite borrows which rows from which other one.
 */
export const SPRITES = {
  /* ---- action buttons: 13x15 at rest, 13x14 pressed ---- */

  comp: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15474447451.',
    '1454474744541',
    '1544447444451',
    '1534444444351',
    '1544447444451',
    '1454474744541',
    '1354744474531',
    '.14554345541.',
    '.13345554331.',
    '..133333331..',
    '...1133311...',
    '.....111.....',
  ],
  compDown: [
    '....11111....',
    '..113444311..',
    '.13443234431.',
    '.14363336341.',
    '1343363633431',
    '1433336333341',
    '1423333333241',
    '1433336333341',
    '1343363633431',
    '1343633363431',
    '.13443234431.',
    '.12234443221.',
    '..112222211..',
    '....11111....',
  ],

  pump: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15444444451.',
    '1454447444541',
    '1544774774451',
    '1534444444351',
    '1544447444451',
    '1454474744541',
    '1354744474531',
    '.14554345541.',
    '.13345554331.',
    '..133333331..',
    '...1133311...',
    '.....111.....',
  ],
  pumpDown: [
    '....11111....',
    '..113444311..',
    '.13443234431.',
    '.14333333341.',
    '1343336333431',
    '1433363633341',
    '1423633363241',
    '1433336333341',
    '1343363633431',
    '1343633363431',
    '.13443234431.',
    '.12234443221.',
    '..112222211..',
    '....11111....',
  ],

  brake: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15444444451.',
    '1454744474541',
    '1544474744451',
    '1534447444351',
    '1544744474451',
    '1454474744541',
    '1354447444531',
    '.14554345541.',
    '.13345554331.',
    '..133333331..',
    '...1133311...',
    '.....111.....',
  ],
  brakeDown: [
    '....11111....',
    '..113444311..',
    '.13443234431.',
    '.14363336341.',
    '1343363633431',
    '1433336333341',
    '1423633363241',
    '1433363633341',
    '1343336333431',
    '1343333333431',
    '.13443234431.',
    '.12234443221.',
    '..112222211..',
    '....11111....',
  ],

  /* ---- board position: one 13x21 pill, two independent halves ----
   *
   * Row 9 is the divider, a solid run of outline all the way across. Note the halves are NOT the
   * same height: the lower one carries the two-block skirt, so it is eleven rows to the upper
   * one's nine. touch.js splits the hit area on the divider, not down the middle.
   *
   * walkUp is one row shorter than the resting pill (the upper face sinks). walkDn is the same
   * height, because pressing the LOWER half lets everything above it settle down by a block
   * instead — which is why both states have to be stored rather than derived.
   */
  walk: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15444444451.',
    '1454447444541',
    '1544474744451',
    '1534744474351',
    '1534444444351',
    '1534444444351',
    '1111111111111',
    '1534444444351',
    '1534444444351',
    '1534744474351',
    '1544474744451',
    '1454447444541',
    '1354444444531',
    '.14554345541.',
    '.13345554331.',
    '..133333331..',
    '...1133311...',
    '.....111.....',
  ],
  walkUp: [
    '....11111....',
    '..113444311..',
    '.13443334431.',
    '.14333333341.',
    '1343336333431',
    '1433363633341',
    '1423633363241',
    '1423333333241',
    '1111111111111',
    '1534444444351',
    '1534444444351',
    '1534744474351',
    '1544474744451',
    '1454447444541',
    '1354444444531',
    '.14554345541.',
    '.13345554331.',
    '..133333331..',
    '...1133311...',
    '.....111.....',
  ],
  walkDn: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15444444451.',
    '1454447444541',
    '1544474744451',
    '1534744474351',
    '1534444444351',
    '1534444444351',
    '1323333333231',
    '1111111111111',
    '1423333333241',
    '1423333333241',
    '1423633363241',
    '1433363633341',
    '1343336333431',
    '1343333333431',
    '.13443234431.',
    '.12234443221.',
    '..112222211..',
    '....11111....',
  ],

  /* ---- turn stick: a 13x13 thumb riding over an 11x11 hole ----
   *
   * The thumb is two blocks WIDER than the hole, so at rest it covers the socket completely and
   * the control reads as a solid puck. Sliding it reveals the well behind — which is the whole
   * trick, and why this is two sprites and a translation rather than a sprite per position.
   *
   * Travel is three blocks each way. That is not arbitrary: three blocks uncovers two blocks of
   * socket and puts the composite at fifteen blocks wide, which is exactly the width of the
   * baked stick-left / stick-right sprites this pair replaced.
   */
  thumb: [
    '....11111....',
    '..114555411..',
    '.14554345541.',
    '.15444444451.',
    '1454444444541',
    '1544444444451',
    '1534444444351',
    '1544444444451',
    '1454444444541',
    '.15444444451.',
    '.14554345541.',
    '..114555411..',
    '....11111....',
  ],
  hole: [
    '...11111...',
    '..1222221..',
    '.122222221.',
    '12222222221',
    '12222222221',
    '12222222221',
    '12222222221',
    '12222222221',
    '.122222221.',
    '..1222221..',
    '...11111...',
  ],
};

/** PAL, pre-parsed to bytes, so rasterising is not re-parsing hex per pixel. */
const RGB = {};
for (const [k, hex] of Object.entries(PAL)) {
  RGB[k] = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const cache = new Map();

/**
 * Rasterise a sprite to a data-URL PNG, one pixel per art block.
 *
 * Deliberately NOT scaled up here. A 13x15 PNG stretched by CSS with image-rendering: pixelated
 * is crisp at every size and re-crisps itself when a media query changes the block size, whereas
 * baking a scale in would pin the art to one viewport and cost ~50x the pixels.
 *
 * @param {keyof typeof SPRITES} name
 * @returns {string} a data: URL, memoised
 */
export function spriteUrl(name) {
  const hit = cache.get(name);
  if (hit) return hit;

  const rows = SPRITES[name];
  if (!rows) throw new Error(`unknown sprite: ${name}`);

  const w = rows[0].length, h = rows.length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.') continue;          // leave it fully transparent
      const c = RGB[ch];
      const i = (y * w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const url = cv.toDataURL('image/png');
  cache.set(name, url);
  return url;
}

/** Block dimensions of a sprite, for CSS to size its box in art blocks. */
export function spriteSize(name) {
  const rows = SPRITES[name];
  return { cols: rows[0].length, rows: rows.length };
}
