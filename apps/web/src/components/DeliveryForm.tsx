'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCart } from '@/lib/cart';
import { formatXaf } from '@/lib/format';
import { SubmitButton } from './SubmitButton';

interface Zone {
  id: string;
  city: string;
  name: string;
  pickupPoints: Array<{ id: string; name: string; landmark: string }>;
}

interface Address {
  zoneId: string;
  mode: 'home' | 'pickup_point';
  pickupPointId: string;
  recipientName: string;
  phone: string;
  landmark: string;
}

const ADDRESS_KEY = 'zandu.lastAddress';

/**
 * Livraison par repères (pas de rue numérotée) : quartier, domicile ou point relais. La dernière
 * adresse est retenue dans le navigateur. Les articles viennent du panier local.
 */
export function DeliveryForm({
  zones,
  defaultPhone,
  only,
  action,
  idempotencyKey,
}: {
  zones: Zone[];
  defaultPhone: string;
  only: string[] | null;
  action: (form: FormData) => Promise<void>;
  idempotencyKey: string;
}) {
  const all = useCart();
  const lines = useMemo(() => all.filter((l) => !only || only.includes(l.productId)), [all, only]);
  const [address, setAddress] = useState<Address>({
    zoneId: '',
    mode: 'home',
    pickupPointId: '',
    recipientName: '',
    phone: defaultPhone,
    landmark: '',
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ADDRESS_KEY);
      if (saved) setAddress(JSON.parse(saved) as Address);
    } catch {
      // pas d'adresse retenue
    }
  }, []);
  const set = (patch: Partial<Address>) => setAddress((a) => ({ ...a, ...patch }));
  const zone = zones.find((z) => z.id === address.zoneId);
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  if (lines.length === 0) return <p className="card muted">Votre panier est vide.</p>;

  return (
    <form
      action={action}
      className="stack"
      onSubmit={() => {
        try {
          localStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
        } catch {
          // stockage indisponible
        }
      }}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(lines.map((l) => ({ productId: l.productId, quantity: l.quantity })))}
      />
      <section className="card stack">
        <h2>Récapitulatif</h2>
        {lines.map((l) => (
          <div key={l.productId} className="row small">
            <span>
              {l.quantity} × {l.title}
            </span>
            <strong>{formatXaf(l.price * l.quantity)}</strong>
          </div>
        ))}
        <div className="row">
          <strong>Articles</strong>
          <strong>{formatXaf(total)}</strong>
        </div>
      </section>
      <section className="card stack">
        <label>
          Quartier de livraison
          <select
            name="zoneId"
            required
            value={address.zoneId}
            onChange={(e) => set({ zoneId: e.target.value, pickupPointId: '' })}
            data-testid="zone"
          >
            <option value="" disabled>
              Choisir un quartier
            </option>
            {['Pointe-Noire', 'Brazzaville'].map((city) => (
              <optgroup key={city} label={city}>
                {zones
                  .filter((z) => z.city === city)
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="options" role="radiogroup" aria-label="Mode de livraison">
          <label className="option">
            <input
              type="radio"
              name="mode"
              value="home"
              checked={address.mode === 'home'}
              onChange={() => set({ mode: 'home' })}
            />
            À domicile
          </label>
          {zone?.pickupPoints.length ? (
            <label className="option">
              <input
                type="radio"
                name="mode"
                value="pickup_point"
                checked={address.mode === 'pickup_point'}
                onChange={() => set({ mode: 'pickup_point' })}
              />
              En point relais (moins cher)
            </label>
          ) : null}
        </div>
        {address.mode === 'pickup_point' && zone ? (
          <label>
            Point relais
            <select
              name="pickupPointId"
              required
              value={address.pickupPointId}
              onChange={(e) => set({ pickupPointId: e.target.value })}
            >
              <option value="" disabled>
                Choisir un point relais
              </option>
              {zone.pickupPoints.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {pp.name} — {pp.landmark}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
      <section className="card stack">
        <label>
          Nom du destinataire
          <input
            name="recipientName"
            required
            minLength={2}
            maxLength={80}
            value={address.recipientName}
            onChange={(e) => set({ recipientName: e.target.value })}
            autoComplete="name"
            data-testid="recipient"
          />
        </label>
        <label>
          Téléphone du destinataire
          <input
            name="phone"
            type="tel"
            required
            value={address.phone}
            onChange={(e) => set({ phone: e.target.value })}
            autoComplete="tel"
          />
        </label>
        <label>
          Repère pour le livreur
          <textarea
            name="landmark"
            required
            minLength={5}
            maxLength={300}
            placeholder="Ex. Tié-Tié, derrière l’école Saint-Pierre, portail bleu"
            value={address.landmark}
            onChange={(e) => set({ landmark: e.target.value })}
            data-testid="landmark"
          />
        </label>
      </section>
      <SubmitButton testId="checkout-continue">Continuer vers le paiement</SubmitButton>
    </form>
  );
}
