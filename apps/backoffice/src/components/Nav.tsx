'use client';

import {
  Bike,
  BookOpenCheck,
  ChartColumn,
  CreditCard,
  Flag,
  House,
  LayoutGrid,
  Package,
  Percent,
  Scale,
  Settings,
  Store,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Icônes du menu (maquettes Admin), désignées par un nom pour traverser la frontière serveur. */
const ICONS = {
  home: House,
  orders: Package,
  disputes: Flag,
  sellers: Store,
  riders: Bike,
  customers: UserRound,
  catalog: LayoutGrid,
  payments: CreditCard,
  settings: Settings,
  reports: ChartColumn,
  commissions: Percent,
  staff: Users,
  reconciliation: Scale,
  accounting: BookOpenCheck,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

interface Item {
  href: string;
  label: string;
  icon: NavIcon;
  count?: number;
  /** Compteur en corail (litige en retard, alerte). */
  hot?: boolean;
}

export function Nav({ items, title }: { items: Item[]; title?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={title ?? 'Menu principal'}>
      {title ? <div className="nav-title">{title}</div> : null}
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden />
            <span className="nav-label">{item.label}</span>
            {item.count ? (
              <span className={`count ${item.hot ? 'hot' : ''}`}>{item.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
