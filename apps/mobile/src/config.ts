import { Platform } from 'react-native';

/**
 * Adresse de l'API. En développement : http://localhost:3000 (web), http://10.0.2.2:3000
 * (émulateur Android) ou l'adresse IP du poste (téléphone réel), via EXPO_PUBLIC_API_URL.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * APK de test : l'adresse du serveur se saisit dans l'application (écran « Serveur de test »),
 * et le code SMS de test s'y lit directement. Jamais dans l'application publiée.
 */
export const SERVER_PICKER = process.env.EXPO_PUBLIC_SERVER_PICKER === '1';

/**
 * Démonstration locale (docs/exploitation/demo-locale.md) : l'application répond elle-même avec
 * des données fictives, sans serveur. Jamais dans l'application publiée.
 */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

/** Affiche le bouton « Simuler la validation du PIN » (simulateur d'agrégateur, jamais en production). */
export const SIMULATOR_ENABLED = process.env.EXPO_PUBLIC_SIMULATOR === '1';

/**
 * Recette (ADR-0013) : les SMS ne partent pas encore vers les téléphones. L'écran du code ouvre
 * la page des SMS de test du site, ex. https://recette.zandu.cg/recette/sms.
 */
export const RECETTE_SMS_URL = process.env.EXPO_PUBLIC_RECETTE_SMS_URL || null;

/**
 * Notifications sur le téléphone (ADR-0018) : identifiant du projet Expo qui relaie les
 * notifications vers Firebase. Sans lui, l'application ne s'enregistre pas et les messages
 * passent par WhatsApp/SMS comme avant.
 */
export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || null;

/** Adresse du site, pour partager une fiche produit (ex. https://zandu.cg). Facultatif. */
export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL || null;

/**
 * Tuiles de la carte « livreur en route » (docs/ux/03 §15), schéma {z}/{x}/{y}. Par défaut les
 * tuiles d'OpenStreetMap, réservées aux essais (leur règlement interdit un usage intensif) ; en
 * production, celles d'un fournisseur (MapTiler, Stadia…) via EXPO_PUBLIC_MAP_TILES.
 */
/**
 * Carte Google Maps (suivi en direct, choix de la porte) : clé d'API Google propre à chaque
 * système, restreinte à l'application dans la console Google Cloud. Sans clé, la petite carte
 * en tuiles prend le relais.
 */
export const GOOGLE_MAPS_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || null
    : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || null;
export const GOOGLE_MAPS_ENABLED = Platform.OS !== 'web' && !!GOOGLE_MAPS_KEY;

export const MAP_TILES =
  process.env.EXPO_PUBLIC_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || '© OpenStreetMap';
