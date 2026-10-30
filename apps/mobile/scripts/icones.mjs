// Icône et écran de démarrage de l'application (et icônes du site), dessinés ici pour rester
// alignés sur les couleurs de packages/design : « z » citron et point, sur le fond sombre.
// Relancer après un changement de marque : node apps/mobile/scripts/icones.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../api/package.json'),
);
const sharp = require('sharp');
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const BG = '#0B0E15';
const BRAND = '#C6F432';

/** Le « z » (trait épais, coins nets) et le point, dans une boîte de 100 × 100. */
const mark = `
  <path d="M22 26 H70 V38 L40 66 H70 V78 H20 V66 L50 38 H22 Z" fill="${BRAND}"/>
  <circle cx="80" cy="72" r="6.5" fill="${BRAND}"/>`;

/** `scale` : part du carré occupée par le dessin (zone sûre des icônes adaptatives Android). */
const svg = (size, { scale = 0.72, background = true, rounded = false } = {}) => {
  const box = size * scale;
  const offset = (size - box) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    ${background ? `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${BG}"/>` : ''}
    <g transform="translate(${offset} ${offset}) scale(${box / 100})">${mark}</g>
  </svg>`);
};

const out = async (file, buffer, size) =>
  sharp(buffer).resize(size, size).png({ compressionLevel: 9 }).toFile(join(root, file));

await out('apps/mobile/assets/icon.png', svg(1024), 1024);
// Android : premier plan seul (le fond vient de adaptiveIcon.backgroundColor), dans les 66 % sûrs.
await out(
  'apps/mobile/assets/adaptive-icon.png',
  svg(1024, { scale: 0.5, background: false }),
  1024,
);
await out('apps/mobile/assets/splash-icon.png', svg(512, { scale: 0.9, background: false }), 512);
await out('apps/web/public/icon-512.png', svg(512), 512);
await out('apps/web/public/icon-192.png', svg(192), 192);
await out('apps/web/src/app/icon.png', svg(64, { scale: 0.8, rounded: true }), 64);
console.log('Icônes écrites.');
