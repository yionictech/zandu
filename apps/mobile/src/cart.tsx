import type { ProductCard } from '@zandu/api-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { loadJson, saveJson } from './storage';

const CART_KEY = 'zandu.cart';

export interface CartLine {
  productId: string;
  title: string;
  price: number;
  coverImage: string | null;
  sellerId: string;
  shopName: string;
  quantity: number;
  stock: number;
  /** Plat de restaurant : propositions choisies (une par choix) ; price comprend les suppléments. */
  options?: string[];
}

/** Identifiant d'une ligne : le produit, et ses choix pour un plat (deux tailles = deux lignes). */
export const lineKey = (l: Pick<CartLine, 'productId' | 'options'>): string =>
  l.options?.length ? `${l.productId}|${l.options.join('|')}` : l.productId;

interface CartValue {
  lines: CartLine[];
  count: number;
  itemsTotal: number;
  add(product: ProductCard, quantity?: number, choice?: { options: string[]; extra: number }): void;
  /** key : lineKey(ligne). */
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  removeMany(productIds: string[]): void;
}

const CartContext = createContext<CartValue | null>(null);

/** Panier multi-vendeurs conservé sur le téléphone (rien n'est perdu si l'application se ferme). */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadJson<CartLine[]>(CART_KEY, []).then((saved) => {
      setLines(saved);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (loaded) void saveJson(CART_KEY, lines);
  }, [lines, loaded]);

  const add = useCallback(
    (product: ProductCard, quantity = 1, choice?: { options: string[]; extra: number }) => {
      const options = choice?.options.length ? choice.options : undefined;
      const key = lineKey({ productId: product.id, options });
      setLines((current) => {
        const existing = current.find((l) => lineKey(l) === key);
        if (existing) {
          return current.map((l) =>
            lineKey(l) === key
              ? { ...l, quantity: Math.min(l.quantity + quantity, product.stock) }
              : l,
          );
        }
        return [
          ...current,
          {
            productId: product.id,
            title: options ? `${product.title} (${options.join(', ')})` : product.title,
            price: product.price + (choice?.extra ?? 0),
            ...(options ? { options } : {}),
            coverImage: product.coverImage,
            sellerId: product.seller.id,
            shopName: product.seller.shopName,
            quantity: Math.min(quantity, product.stock),
            stock: product.stock,
          },
        ];
      });
    },
    [],
  );

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      current
        .map((l) => (lineKey(l) === key ? { ...l, quantity: Math.min(quantity, l.stock) } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((l) => lineKey(l) !== key));
  }, []);

  const removeMany = useCallback((productIds: string[]) => {
    setLines((current) => current.filter((l) => !productIds.includes(l.productId)));
  }, []);

  const value = useMemo(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      itemsTotal: lines.reduce((sum, l) => sum + l.price * l.quantity, 0),
      add,
      setQuantity,
      remove,
      removeMany,
    }),
    [lines, add, setQuantity, remove, removeMany],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart hors de CartProvider');
  return value;
}
