import type { Metadata } from 'next';
import { CartView } from '@/components/CartView';

export const metadata: Metadata = { title: 'Mon panier', robots: { index: false } };

export default function CartPage() {
  return (
    <main>
      <h1>Mon panier</h1>
      <CartView />
    </main>
  );
}
