// Configuration Metro pour le monorepo : les paquets partagés (@zandu/domain, @zandu/api-client)
// sont consommés directement depuis leurs sources TypeScript.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const packagesDir = `${path.sep}packages${path.sep}`;

// Condition d'export « zandu-source » : pointe vers src/index.ts au lieu de dist/.
config.resolver.unstable_conditionNames = [
  'zandu-source',
  ...config.resolver.unstable_conditionNames,
];

// Les paquets partagés suivent la convention ESM de Node (`import './money.js'` pour money.ts).
const defaultResolve = config.resolver.resolveRequest;
// Hors démonstration (EXPO_PUBLIC_DEMO=1), l'API fictive et ses photos restent hors du paquet.
const demoStub = path.join(__dirname, 'src', 'demo-stub.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@zandu/demo' && process.env.EXPO_PUBLIC_DEMO !== '1')
    return { type: 'sourceFile', filePath: demoStub };
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.includes(packagesDir)
  ) {
    try {
      return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
    } catch {
      // pas de fichier .ts : résolution normale
    }
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
