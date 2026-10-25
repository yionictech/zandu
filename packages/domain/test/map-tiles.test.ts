import { describe, expect, it } from 'vitest';
import { tilesAround, tileUrl } from '../src/index.js';

describe('Tuiles de carte', () => {
  it('couvre le cadre autour du point, le point au centre', () => {
    const tiles = tilesAround(-4.7761, 11.8635, 16, 320, 180);
    // Pointe-Noire au zoom 16 : tuile x 34928, y 33636 environ.
    expect(tiles.some((t) => t.x === 34927 || t.x === 34928)).toBe(true);
    // Le cadre est entièrement couvert : de gauche à droite et de haut en bas.
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + 256))).toBeGreaterThanOrEqual(320);
    expect(Math.max(...tiles.map((t) => t.top + 256))).toBeGreaterThanOrEqual(180);
    expect(tiles.length).toBeLessThanOrEqual(6);
  });

  it('forme l’adresse d’une tuile', () => {
    expect(tileUrl('https://t.example/{z}/{x}/{y}.png', { z: 16, x: 3, y: 4 })).toBe(
      'https://t.example/16/3/4.png',
    );
  });
});
