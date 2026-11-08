import { DomainError } from './errors.js';
import { arrivalMinutes, distanceMeters } from './geo.js';
import type { LatLng } from './map-tiles.js';

/**
 * Prix d'une course de moto-taxi : prise en charge + prix au kilomètre (distance à vol
 * d'oiseau, détour compris), arrondi aux 50 FCFA supérieurs, avec un minimum. Le conducteur
 * reçoit 85 % (arrondi aux 50 FCFA inférieurs), Zandu garde le reste.
 */
export const RIDE_PRICING = {
  base: 300,
  perKm: 150,
  minimum: 500,
  detour: 1.3,
  courierPercent: 85,
  maxKm: 30,
} as const;

export interface RideQuote {
  price: number;
  courierShare: number;
  distanceMeters: number;
  etaMinutes: number;
}

const up50 = (n: number) => Math.ceil(n / 50) * 50;
const down50 = (n: number) => Math.floor(n / 50) * 50;

export function rideQuote(from: LatLng, to: LatLng): RideQuote {
  const straight = distanceMeters(from, to);
  const road = straight * RIDE_PRICING.detour;
  if (road < 200) throw new DomainError('ride_too_short', 'Départ et arrivée trop proches');
  if (road > RIDE_PRICING.maxKm * 1000)
    throw new DomainError('ride_too_long', `Course de ${RIDE_PRICING.maxKm} km au plus`);
  const price = Math.max(
    RIDE_PRICING.minimum,
    up50(RIDE_PRICING.base + (RIDE_PRICING.perKm * road) / 1000),
  );
  return {
    price,
    courierShare: down50((price * RIDE_PRICING.courierPercent) / 100),
    distanceMeters: Math.round(road),
    etaMinutes: arrivalMinutes(from, to),
  };
}
