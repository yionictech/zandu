import type { LatLng } from './map-tiles.js';

/**
 * Distances et temps d'arrivée du livreur (docs/ux/03 §16). Pas de calcul d'itinéraire : la
 * distance à vol d'oiseau est allongée d'un facteur de détour, à la vitesse d'une moto en ville.
 */
const EARTH_RADIUS_M = 6_371_000;
/** Les rues ne vont pas en ligne droite : environ 40 % de plus qu'à vol d'oiseau. */
export const DETOUR_FACTOR = 1.4;
/** Moto en ville, embouteillages compris. */
export const CITY_SPEED_KMH = 18;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Minutes avant l'arrivée, arrondies à la minute supérieure (au moins 1). */
export function arrivalMinutes(from: LatLng, to: LatLng): number {
  const meters = distanceMeters(from, to) * DETOUR_FACTOR;
  return Math.max(1, Math.ceil(meters / ((CITY_SPEED_KMH * 1000) / 60)));
}

/** Le repère est bien au Congo (protège contre un téléphone mal réglé ou une saisie farfelue). */
export const isInCongo = ({ lat, lng }: LatLng): boolean =>
  lat >= -5.2 && lat <= 3.8 && lng >= 11 && lng <= 18.8;

/** « 850 m », « 2,4 km ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
