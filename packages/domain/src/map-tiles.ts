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

export function tilesAround(
  lat: number,
  lng: number,
  zoom: number,
  width: number,
  height: number,
): Tile[] {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  const px = ((lng + 180) / 360) * n * TILE_SIZE;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE_SIZE;
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
