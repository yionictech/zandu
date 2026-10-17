/**
 * Partage : WhatsApp d'abord (le canal n°1 au Congo). Lien simple, sans script : il marche même
 * avant le chargement de la page. L'aperçu (photo, titre, prix) vient des balises Open Graph.
 */
export function ShareButtons({ url, text }: { url: string; text: string }) {
  const message = encodeURIComponent(`${text}\n${url}`);
  return (
    <div className="share">
      <a
        className="button whatsapp"
        href={`https://wa.me/?text=${message}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="share-whatsapp"
      >
        Partager sur WhatsApp
      </a>
      <a
        className="button ghost"
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Facebook
      </a>
    </div>
  );
}
