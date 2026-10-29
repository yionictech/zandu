// Configuration Expo : app.json, plus le fichier Firebase quand il est fourni (ADR-0018).
// google-services.json n'est jamais versionné : l'APK de recette l'écrit depuis un secret GitHub.
// Sans lui, l'application se construit sans notifications (WhatsApp/SMS prennent le relais).
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { withAndroidManifest } = require('expo/config-plugins');

/**
 * APK de test (EXPO_PUBLIC_SERVER_PICKER=1, docs/exploitation/apk-de-test.md) : autorise le HTTP simple,
 * pour joindre une API sur un ordinateur du Wi-Fi (http://192.168.x.x:3000). Jamais en production.
 */
const withTestCleartext = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });

module.exports = ({ config }) => {
  const firebase = join(__dirname, 'google-services.json');
  let result = existsSync(firebase)
    ? { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } }
    : config;
  // Démonstration locale (EXPO_PUBLIC_DEMO=1, docs/exploitation/demo-locale.md) : application à
  // part, installable à côté des autres versions, sans serveur.
  if (process.env.EXPO_PUBLIC_DEMO === '1') {
    return {
      ...result,
      name: `${result.name} (démo)`,
      android: { ...result.android, package: `${result.android.package}.demo` },
    };
  }
  if (process.env.EXPO_PUBLIC_SERVER_PICKER === '1') {
    result = {
      ...withTestCleartext(result),
      name: `${result.name} (test)`,
    };
  }
  return result;
};
