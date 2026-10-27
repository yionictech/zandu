/**
 * Petite carte sans bibliothèque (docs/ux/03 §15) : les tuiles carrées de 256 px (schéma
 * « XYZ » d'OpenStreetMap) qui couvrent un cadre centré sur un point. L'application et le site
 * les posent simplement côte à côte, avec un repère au centre.
 */
export const TILE_SIZE = 256;

export interface Tile {
  z: number;
  x: number;
  y: number;
  /** Position du coin haut gauche de la tuile dans le cadre, en pixels. */
  left: number;
  top: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Position d'un point sur la carte du monde entière au zoom donné, en pixels. */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = 2 ** zoom * TILE_SIZE;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

/** Décalage en pixels d'un point par rapport au centre du cadre (pour y poser un second repère). */
export function offsetFromCenter(
  center: LatLng,
  point: LatLng,
  zoom: number,
): { dx: number; dy: number } {
  const c = worldPixel(center.lat, center.lng, zoom);
  const p = worldPixel(point.lat, point.lng, zoom);
  return { dx: p.x - c.x, dy: p.y - c.y };
}

/** Point de la carte touché à (dx, dy) pixels du centre : déplacer le repère d'un toucher. */
export function latLngAtOffset(center: LatLng, zoom: number, dx: number, dy: number): LatLng {
  const size = 2 ** zoom * TILE_SIZE;
  const c = worldPixel(center.lat, center.lng, zoom);
  const x = c.x + dx;
  const y = c.y + dy;
  const lng = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export function tilesAround(
  lat: number,
  lng: number,
  zoom: number,
  width: number,
  height: number,
): Tile[] {
  const n = 2 ** zoom;
  const { x: px, y: py } = worldPixel(lat, lng, zoom);
  const left = px - width / 2;
  const top = py - height / 2;
  const tiles: Tile[] = [];
  for (
    let ty = Math.floor(top / TILE_SIZE);
    ty <= Math.floor((top + height - 1) / TILE_SIZE);
    ty++
  ) {
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + width - 1) / TILE_SIZE);
      tx++
    ) {
      if (ty < 0 || ty >= n) continue;
      tiles.push({
        z: zoom,
        x: ((tx % n) + n) % n,
        y: ty,
        left: Math.round(tx * TILE_SIZE - left),
        top: Math.round(ty * TILE_SIZE - top),
      });
    }
  }
  return tiles;
}

/** « https://tile.openstreetmap.org/{z}/{x}/{y}.png » → adresse d'une tuile. */
export const tileUrl = (template: string, t: Pick<Tile, 'z' | 'x' | 'y'>): string =>
  template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
