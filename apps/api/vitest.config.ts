import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['zandu-source'] },
  ssr: { resolve: { conditions: ['zandu-source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Les tests d'intégration partagent une base PostgreSQL : exécution en série.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
