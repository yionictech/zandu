import { setTimeout as sleep } from 'node:timers/promises';
import { createContext } from './bootstrap.js';
import { runSweepers } from './jobs/sweepers.js';

/**
 * Processus de fond : expirations, interrogation de l'agrégateur, reversements,
 * remboursements, notifications. Peut tourner en plusieurs exemplaires.
 */
const ctx = createContext();
let running = true;
process.once('SIGTERM', () => (running = false));
process.once('SIGINT', () => (running = false));

console.log(`Worker démarré (cycle ${ctx.config.workerTickMs} ms)`);
while (running) {
  const counts = await runSweepers(ctx, (name, error) => console.error(`[${name}]`, error));
  const busy = Object.entries(counts).filter(([, n]) => n > 0);
  if (busy.length)
    console.log(JSON.stringify({ at: new Date().toISOString(), ...Object.fromEntries(busy) }));
  await sleep(ctx.config.workerTickMs);
}
await ctx.pool.end();
