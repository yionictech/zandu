// Régénère src/photos.ts depuis db/seeds/demo/images (photos de démonstration intégrées à
// l'application) : node packages/demo/scripts/photos.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = join(root, 'db', 'seeds', 'demo', 'images');
const entries = readdirSync(dir)
  .filter((f) => f.endsWith('.jpg'))
  .sort()
  .map((f) => {
    const data = readFileSync(join(dir, f)).toString('base64');
    return `  '${f.replace(/\.jpg$/, '')}':\n    'data:image/jpeg;base64,${data}',`;
  });
writeFileSync(
  join(root, 'packages', 'demo', 'src', 'photos.ts'),
  `// Généré depuis db/seeds/demo/images (photos de démonstration, ~10 Ko chacune) : ne pas modifier à la main.
// Intégrées à l'application de démonstration, qui fonctionne sans serveur (docs/exploitation/demo-locale.md).
// Régénérer : node packages/demo/scripts/photos.mjs
export const DEMO_PHOTOS: Record<string, string> = {
${entries.join('\n')}
};
`,
);
