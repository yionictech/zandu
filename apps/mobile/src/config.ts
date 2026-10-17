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
