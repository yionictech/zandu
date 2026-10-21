import {
  LayoutGrid,
  Laptop,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/** Mêmes icônes que l'application (maquette « Accueil »). */
const ICONS: Record<string, LucideIcon> = {
  electronique: Smartphone,
  telephones: Smartphone,
  informatique: Laptop,
  mode: Shirt,
  beaute: Sparkles,
  maison: Sofa,
  alimentation: ShoppingBasket,
};

export function CategoryIcon({ slug }: { slug: string | null }) {
  const Icon = (slug && ICONS[slug]) || LayoutGrid;
  return <Icon className="icon" aria-hidden strokeWidth={1.8} />;
}
