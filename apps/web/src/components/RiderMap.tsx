import { tilesAround, tileUrl } from '@zandu/domain';
import { Bike } from 'lucide-react';

/** Tuiles de la carte (docs/ux/03 §15) : OpenStreetMap pour les essais, un fournisseur en production. */
const TILES = process.env.ZANDU_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.ZANDU_MAP_ATTRIBUTION || '© OpenStreetMap';
/** Cadre de référence : les tuiles sont placées autour du centre, quelle que soit la largeur. */
const WIDTH = 680;
const HEIGHT = 200;

/** Petite carte centrée sur le livreur, en images simples (aucun script). */
export function RiderMap({ lat, lng }: { lat: number; lng: number }) {
  const tiles = tilesAround(lat, lng, 16, WIDTH, HEIGHT);
  return (
    <div className="map" style={{ height: HEIGHT }} aria-label="Position du livreur">
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${t.x}-${t.y}`}
          src={tileUrl(TILES, t)}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          style={{ left: `calc(50% + ${t.left - WIDTH / 2}px)`, top: t.top }}
        />
      ))}
      <span className="map-marker">
        <Bike className="icon" aria-hidden />
      </span>
      <small className="map-attribution">{ATTRIBUTION}</small>
    </div>
  );
}
