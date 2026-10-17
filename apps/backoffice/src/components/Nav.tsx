'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: string;
  label: string;
  count?: number;
  /** Compteur en rouge (litige en retard, alerte). */
  hot?: boolean;
}

export function Nav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu principal">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span>{item.label}</span>
            {item.count ? (
              <span className={`count ${item.hot ? 'hot' : ''}`}>{item.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
