// Configuration Expo : app.json, plus le fichier Firebase quand il est fourni (ADR-0018).
// google-services.json n'est jamais versionné : l'APK de recette l'écrit depuis un secret GitHub.
// Sans lui, l'application se construit sans notifications (WhatsApp/SMS prennent le relais).
const { join } = require('node:path');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

/**
 * APK de test (EXPO_PUBLIC_SERVER_PICKER=1, docs/exploitation/apk-de-test.md) : autorise le HTTP simple,
 * pour joindre une API sur un ordinateur du Wi-Fi (http://192.168.x.x:3000). Jamais en production.
 */
const withTestCleartext = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });

/**
 * Version publiée sur les stores (profil EAS « production », docs/exploitation/publication-stores.md) :
 * refuse de se construire sans adresses https, ou avec un réglage de test ou de démonstration.
 */
function checkStoreBuild(env) {
  if (env.EAS_BUILD_PROFILE !== 'production') return;
  const problems = [];
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SITE_URL'])
    if (!(env[name] ?? '').startsWith('https://'))
      problems.push(`${name} doit commencer par https://`);
  for (const name of [
    'EXPO_PUBLIC_DEMO',
    'EXPO_PUBLIC_SERVER_PICKER',
    'EXPO_PUBLIC_SIMULATOR',
    'EXPO_PUBLIC_RECETTE_SMS_URL',
  ])
    if (env[name]) problems.push(`${name} est interdit dans la version des stores`);
  if (problems.length) throw new Error(`Version des stores refusée :\n- ${problems.join('\n- ')}`);
}

/**
 * Appels (WebRTC de LiveKit) : la version optimisée d'Android (R8) ne doit ni supprimer ni
 * renommer les classes appelées depuis le code natif.
 */
const PROGUARD_CALLS = `
# Appels dans l'application (LiveKit / WebRTC)
-keep class livekit.org.webrtc.** { *; }
-keep class livekit.org.jni_zero.** { *; }
-dontwarn livekit.org.jni_zero.JniZeroJni
`;
const withCallsProguard = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const file = join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const rules = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (!rules.includes('livekit.org.webrtc')) writeFileSync(file, rules + PROGUARD_CALLS);
      return mod;
    },
  ]);

module.exports = ({ config }) => {
  checkStoreBuild(process.env);
  config = withCallsProguard(config);
  // Carte Google Maps (docs/exploitation/google-maps.md) : une clé par système, sans clé la carte
  // en tuiles prend le relais.
  config = {
    ...config,
    plugins: [
      ...config.plugins,
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || undefined,
          iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || undefined,
        },
      ],
    ],
  };
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
      ios: { ...result.ios, bundleIdentifier: `${result.ios.bundleIdentifier}.demo` },
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
