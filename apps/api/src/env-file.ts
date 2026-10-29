import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Appelée par les points d'entrée (API, worker, migrations, données), jamais par les tests.
 *
 * Poste de développement : lit le fichier `.env` à la racine du dépôt, s'il existe, sans écraser
 * les variables déjà définies. Évite `export $(…)`, qui n'existe pas sous Windows
 * (docs/exploitation/apk-de-test.md). Sans effet en recette et en production : pas de fichier.
 */
export function loadDevEnvFile(): void {
  const file = new URL('../../../.env', import.meta.url);
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Ce fichier est-il le script lancé (`tsx src/db/migrate.ts`) ? Comparaison tolérante aux
 * chemins Windows (casse, barres obliques), sinon la migration ne ferait rien sans rien dire.
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const launched = process.argv[1];
  if (!launched) return false;
  const norm = (path: string) => {
    const full = resolve(path);
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  return norm(launched) === norm(fileURLToPath(moduleUrl));
}
