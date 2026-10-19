// Configuration Expo : app.json, plus le fichier Firebase quand il est fourni (ADR-0018).
// google-services.json n'est jamais versionné : l'APK de recette l'écrit depuis un secret GitHub.
// Sans lui, l'application se construit sans notifications (WhatsApp/SMS prennent le relais).
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = ({ config }) => {
  const firebase = join(__dirname, 'google-services.json');
  return existsSync(firebase)
    ? { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } }
    : config;
};
