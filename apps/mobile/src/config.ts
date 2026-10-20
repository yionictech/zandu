/**
 * Adresse de l'API. En développement : http://localhost:3000 (web), http://10.0.2.2:3000
 * (émulateur Android) ou l'adresse IP du poste (téléphone réel), via EXPO_PUBLIC_API_URL.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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
