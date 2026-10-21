import type { Metadata } from 'next';
import { catalog, mine } from '@/lib/api';
import { BuyAgain } from '@/components/BuyAgain';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Racheter', robots: { index: false } };

/**
 * « Racheter » : remet les articles d'une commande au panier, au prix du moment (comme
 * l'application). Les produits retirés de la vente sont ignorés.
 */
export default async function BuyAgainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await mine(`/racheter/${id}`, (api) =>
    api.GET('/v1/orders/{id}', { params: { path: { id } } }),
  );
  const products = await Promise.all(
    order.items.map(async (item) => {
      try {
        const p = await catalog((api) =>
          api.GET('/v1/products/{id}', { params: { path: { id: item.productId } } }),
        );
        return p.stock > 0
          ? {
              productId: p.id,
              title: p.title,
              price: p.price,
              coverImage: p.coverImage,
              sellerId: p.seller.id,
              shopName: p.seller.shopName,
              stock: p.stock,
              quantity: Math.min(item.quantity, p.stock),
            }
          : null;
      } catch {
        return null;
      }
    }),
  );
  return (
    <main style={{ maxWidth: 560 }}>
      <BuyAgain lines={products.filter((p) => p !== null)} />
    </main>
  );
}
