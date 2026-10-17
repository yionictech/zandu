'use client';

import { useCart } from '@/lib/cart';

export function CartCount() {
  const count = useCart().reduce((n, l) => n + l.quantity, 0);
  return count ? (
    <span className="badge-count" aria-label={`${count} article(s)`}>
      {count}
    </span>
  ) : null;
}
