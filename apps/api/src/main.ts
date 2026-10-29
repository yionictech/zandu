import { buildApp } from './app.js';
import { createContext } from './bootstrap.js';
import { loadDevEnvFile } from './env-file.js';

loadDevEnvFile();
const ctx = createContext();
const app = await buildApp(ctx);

const shutdown = async (): Promise<void> => {
  await app.close();
  await ctx.pool.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ port: ctx.config.port, host: ctx.config.host });
