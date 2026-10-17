/**
 * Adresse de l'API. En développement : http://localhost:3000 (web), http://10.0.2.2:3000
 * (émulateur Android) ou l'adresse IP du poste (téléphone réel), via EXPO_PUBLIC_API_URL.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Affiche le bouton « Simuler la validation du PIN » (simulateur d'agrégateur, jamais en production). */
export const SIMULATOR_ENABLED = process.env.EXPO_PUBLIC_SIMULATOR === '1';
