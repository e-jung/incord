// Regenerates every app icon from one hand-drawn cord heart.
// Run after editing the paths below: node scripts/build-icons.mjs
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const TILE = '#4D62D3',
  CREAM = '#FBF3E2',
  WIDTH = 36;
// One cord: in from the left, up the heart's right side, over both lobes,
// down the left side, crossing over itself at the base and out to the right.
const UNDER =
  'M-200 388C90 388 196 390 256 330C316 270 390 246 390 192C390 146 356 118 320 118C294 118 268 132 256 158C244 132 218 118 192 118C156 118 122 146 122 192C122 246 196 270 256 330';
const OVER = 'M122 192C122 246 196 270 256 330C316 390 422 388 712 388';

function icon({ rounded = true, scale = 1, label = false } = {}) {
  const inset = (256 * (1 - scale)).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${label ? ' role="img" aria-label="Incord: a cord tied into a heart"' : ''}>
  <clipPath id="tile"><rect width="512" height="512"${rounded ? ' rx="112"' : ''}/></clipPath>
  <rect width="512" height="512"${rounded ? ' rx="112"' : ''} fill="${TILE}"/>
  <g clip-path="url(#tile)"><g transform="translate(${inset} ${inset}) scale(${scale})" fill="none" stroke-linejoin="round">
    <path d="${UNDER}" stroke="${CREAM}" stroke-width="${WIDTH}" stroke-linecap="round"/>
    <path d="${OVER}" stroke="${TILE}" stroke-width="${WIDTH + 20}"/>
    <path d="${OVER}" stroke="${CREAM}" stroke-width="${WIDTH}"/>
  </g></g>
</svg>
`;
}

// Render at 4x and downsample for clean edges; full-bleed squares drop the alpha channel (iOS shows alpha as black).
const png = (svg, size, file, opaque = false) => {
  const image = sharp(Buffer.from(svg), { density: ((72 * size) / 512) * 4 }).resize(size, size);
  return (opaque ? image.removeAlpha() : image).png({ compressionLevel: 9 }).toFile(file);
};
writeFileSync('public/icon.svg', icon({ label: true }));
await png(icon(), 192, 'public/icon-192.png');
await png(icon(), 512, 'public/icon-512.png');
// iOS and Android masks crop full-bleed squares; maskable keeps the heart inside the 80% safe zone.
await png(icon({ rounded: false }), 180, 'public/apple-touch-icon.png', true);
await png(icon({ rounded: false, scale: 0.8 }), 192, 'public/icon-maskable-192.png', true);
await png(icon({ rounded: false, scale: 0.8 }), 512, 'public/icon-maskable-512.png', true);
