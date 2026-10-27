import { offsetFromCenter, tilesAround, tileUrl, type LatLng } from '@zandu/domain';
import { Bike, House } from 'lucide-react';

/** Tuiles de la carte (docs/ux/03 §15) : OpenStreetMap pour les essais, un fournisseur en production. */
const TILES = process.env.ZANDU_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.ZANDU_MAP_ATTRIBUTION || '© OpenStreetMap';
/** Cadre de référence : les tuiles sont placées autour du centre, quelle que soit la largeur. */
const WIDTH = 680;
const HEIGHT = 200;
/** Demi-largeur sûre (téléphone de 360 px) pour que la maison reste dans le cadre. */
const SAFE_DX = 130;
const SAFE_DY = HEIGHT / 2 - 24;

/** Le zoom le plus proche où la maison du client tient dans le cadre (11 au moins). */
function fitZoom(center: LatLng, home: LatLng | null): number {
  if (!home) return 16;
  for (let z = 16; z > 11; z--) {
    const { dx, dy } = offsetFromCenter(center, home, z);
    if (Math.abs(dx) < SAFE_DX && Math.abs(dy) < SAFE_DY) return z;
  }
  return 11;
}

/**
 * Petite carte centrée sur le livreur, en images simples (aucun script), avec la maison du
 * client si elle tient dans le cadre (docs/ux/03 §16).
 */
export function RiderMap({
  lat,
  lng,
  home = null,
}: {
  lat: number;
  lng: number;
  home?: LatLng | null;
}) {
  const center = { lat, lng };
  const zoom = fitZoom(center, home);
  const tiles = tilesAround(lat, lng, zoom, WIDTH, HEIGHT);
  const offset = home ? offsetFromCenter(center, home, zoom) : null;
  const showHome = offset && Math.abs(offset.dx) < SAFE_DX && Math.abs(offset.dy) < SAFE_DY;
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
      {showHome && offset ? (
        <span
          className="map-marker home"
          style={{
            left: `calc(50% + ${Math.round(offset.dx) - 18}px)`,
            top: `calc(50% + ${Math.round(offset.dy) - 18}px)`,
          }}
          aria-label="Votre adresse"
        >
          <House className="icon" aria-hidden />
        </span>
      ) : null}
      <span className="map-marker">
        <Bike className="icon" aria-hidden />
      </span>
      <small className="map-attribution">{ATTRIBUTION}</small>
    </div>
  );
}
