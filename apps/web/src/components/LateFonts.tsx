'use client';

import { useEffect } from 'react';

/**
 * Police des titres et des prix (docs/ux/03), chargée **après** la page : en 3G, le texte
 * s'affiche d'abord avec la police du téléphone et la page est utilisable sans l'attendre
 * (ADR-0012) ; la police arrive ensuite, puis vient du cache aux visites suivantes.
 */
export function LateFonts() {
  useEffect(() => {
    const load = () => {
      if (!('fonts' in document) || typeof FontFace === 'undefined') return;
      const face = new FontFace(
        'Unbounded',
        "url(/fonts/unbounded-latin-700-normal.woff2) format('woff2')",
        {
          weight: '700',
          display: 'swap',
        },
      );
      face.load().then(
        (loaded) => document.fonts.add(loaded),
        () => undefined,
      );
    };
    if (document.readyState === 'complete') load();
    else window.addEventListener('load', load, { once: true });
  }, []);
  return null;
}
