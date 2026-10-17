import sharp from 'sharp';

/**
 * Déclinaisons d'une photo produit (ADR-0014). Le bord le plus long est réduit, jamais agrandi.
 *   - thumb : vignette des listes (tuile de ~160 px sur un écran ×2 ; ≈ 18 Ko pour une vraie photo) ;
 *   - large : fiche produit (photo haute de ~360 px sur un écran ×2 ; ≈ 95 Ko, budget de la fiche 300 Ko) ;
 *   - share : JPEG des aperçus de lien (WhatsApp, Facebook), format que tous savent lire.
 * Changer un réglage change le nom des fichiers (taille dans la clé) : les caches d'un an restent justes.
 */
export const VARIANTS = {
  thumb: { edge: 320, format: 'webp', quality: 70 },
  large: { edge: 800, format: 'webp', quality: 75 },
  share: { edge: 1200, format: 'jpeg', quality: 80 },
} as const;

export type VariantName = keyof typeof VARIANTS;

export interface RenderedVariant {
  body: Buffer;
  width: number;
  height: number;
  contentType: string;
  extension: string;
}

/** Le fichier n'est pas une image exploitable : inutile de réessayer. */
export class InvalidImageError extends Error {}

/** Refus des « bombes de décompression » : 40 mégapixels, au-delà de tout appareil photo de téléphone. */
const MAX_INPUT_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/** Clé d'une déclinaison, à côté de l'original : products/u/abc.jpg → products/u/abc-thumb320.webp */
export const variantKey = (originalKey: string, name: VariantName): string => {
  const { edge, format } = VARIANTS[name];
  return `${originalKey.replace(/\.[a-z0-9]+$/i, '')}-${name}${edge}.${format === 'jpeg' ? 'jpg' : 'webp'}`;
};

/**
 * Décline une photo : orientation du téléphone appliquée, métadonnées supprimées (position GPS,
 * modèle d'appareil), couleurs ramenées en sRGB. Le fichier est entièrement décodé : un faux JPEG
 * (texte, page HTML) lève InvalidImageError.
 */
export async function renderVariants(input: Buffer): Promise<{
  width: number;
  height: number;
  variants: Record<VariantName, RenderedVariant>;
}> {
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  try {
    const meta = await open().metadata();
    if (!ACCEPTED_FORMATS.has(meta.format ?? ''))
      throw new InvalidImageError(`Format refusé : ${meta.format ?? 'inconnu'}`);
    const variants = {} as Record<VariantName, RenderedVariant>;
    for (const [name, spec] of Object.entries(VARIANTS) as Array<
      [VariantName, (typeof VARIANTS)[VariantName]]
    >) {
      const resized = open()
        .autoOrient()
        .resize({ width: spec.edge, height: spec.edge, fit: 'inside', withoutEnlargement: true });
      const encoded =
        spec.format === 'webp'
          ? resized.webp({ quality: spec.quality })
          : resized.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      variants[name] = {
        body: data,
        width: info.width,
        height: info.height,
        contentType: `image/${spec.format}`,
        extension: spec.format === 'jpeg' ? 'jpg' : 'webp',
      };
    }
    return {
      width: meta.autoOrient?.width ?? meta.width ?? 0,
      height: meta.autoOrient?.height ?? meta.height ?? 0,
      variants,
    };
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    // Erreurs de libvips : fichier tronqué, corrompu ou trop grand.
    throw new InvalidImageError(error instanceof Error ? error.message : String(error));
  }
}
