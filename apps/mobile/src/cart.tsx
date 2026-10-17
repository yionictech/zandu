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
}

interface CartValue {
  lines: CartLine[];
  count: number;
  itemsTotal: number;
  add(product: ProductCard, quantity?: number): void;
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
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

  const add = useCallback((product: ProductCard, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((l) => l.productId === product.id);
      if (existing) {
        return current.map((l) =>
          l.productId === product.id
            ? { ...l, quantity: Math.min(l.quantity + quantity, product.stock) }
            : l,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          title: product.title,
          price: product.price,
          coverImage: product.coverImage,
          sellerId: product.seller.id,
          shopName: product.seller.shopName,
          quantity: Math.min(quantity, product.stock),
          stock: product.stock,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) =>
      current
        .map((l) =>
          l.productId === productId ? { ...l, quantity: Math.min(quantity, l.stock) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((l) => l.productId !== productId));
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
