// Génère tokens.css (variables CSS du site et du back-office) depuis src/tokens.ts.
import { writeFileSync } from 'node:fs';
import { colors, fontFamily, fontSize, radius, space } from '../src/tokens.ts';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const lines = [
  ...Object.entries(colors).map(([k, v]) => `--${kebab(k)}: ${v};`),
  ...Object.entries(space).map(([k, v]) => `--space-${k}: ${v}px;`),
  ...Object.entries(radius).map(([k, v]) => `--radius-${k}: ${v}px;`),
  ...Object.entries(fontSize).map(([k, v]) => `--text-${k}: ${v}px;`),
  `--font-display: '${fontFamily.display}', 'Arial Black', system-ui, sans-serif;`,
  `--font-body: '${fontFamily.body}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;`,
];
writeFileSync(
  new URL('../tokens.css', import.meta.url),
  `/* Généré depuis src/tokens.ts (pnpm --filter @zandu/design generate) : ne pas modifier. */\n:root {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`,
);
