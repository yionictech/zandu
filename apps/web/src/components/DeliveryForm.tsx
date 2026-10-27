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
  /** Repère posé avec la position du téléphone (facultatif, domicile seulement). */
  location?: { lat: number; lng: number; accuracy?: number } | null;
}

const ADDRESS_KEY = 'zandu.lastAddress';
/** Repères ajoutés d'un toucher (maquette « Livraison ») : le livreur cherche des lieux, pas des rues. */
const LANDMARK_HINTS = ['École', 'Église', 'Pharmacie', 'Couleur du portail'];

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
  const [remember, setRemember] = useState(true);
  const set = (patch: Partial<Address>) => setAddress((a) => ({ ...a, ...patch }));
  const zone = zones.find((z) => z.id === address.zoneId);
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  if (lines.length === 0) return <p className="card muted">Votre panier est vide.</p>;

  const cities = ['Pointe-Noire', 'Brazzaville'];
  return (
    <form
      action={action}
      className="stack"
      onSubmit={() => {
        try {
          if (remember) localStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
          else localStorage.removeItem(ADDRESS_KEY);
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
      <p className="eyebrow">Mode de livraison</p>
      <div className="choices" role="radiogroup" aria-label="Mode de livraison">
        <label className="choice">
          <input
            type="radio"
            name="mode"
            value="home"
            checked={address.mode === 'home'}
            onChange={() => set({ mode: 'home' })}
          />
          <HomeIcon />À domicile
          <small>Le livreur vous appelle en arrivant</small>
        </label>
        <label className="choice" aria-disabled={!zone?.pickupPoints.length}>
          <input
            type="radio"
            name="mode"
            value="pickup_point"
            disabled={!!zone && !zone.pickupPoints.length}
            checked={address.mode === 'pickup_point'}
            onChange={() => set({ mode: 'pickup_point' })}
          />
          <StoreIcon />
          Point relais
          <small>Moins cher, vous passez le chercher</small>
        </label>
      </div>
      <section className="card stack">
        <p className="eyebrow">Quartier de livraison</p>
        {cities.map((city) => (
          <div key={city} className="stack" style={{ gap: 8 }}>
            <span className="small muted">{city}</span>
            <div className="pills" role="radiogroup" aria-label={`Quartiers de ${city}`}>
              {zones
                .filter((z) => z.city === city)
                .map((z) => (
                  <label key={z.id} className="pill" data-testid={`zone-${z.name}`}>
                    <input
                      type="radio"
                      name="zoneId"
                      value={z.id}
                      required
                      checked={address.zoneId === z.id}
                      onChange={() =>
                        set({
                          zoneId: z.id,
                          pickupPointId: '',
                          ...(z.pickupPoints.length ? {} : { mode: 'home' as const }),
                        })
                      }
                    />
                    {z.name}
                  </label>
                ))}
            </div>
          </div>
        ))}
        {address.mode === 'pickup_point' && zone?.pickupPoints.length ? (
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
        <div className="pills" aria-label="Ajouter un repère">
          {LANDMARK_HINTS.map((hint) => (
            <button
              key={hint}
              type="button"
              className="pill add"
              onClick={() =>
                set({
                  landmark: `${address.landmark.trim()}${address.landmark.trim() ? ', ' : ''}${hint.toLowerCase()} `,
                })
              }
            >
              + {hint}
            </button>
          ))}
        </div>
        {address.mode === 'home' ? (
          <PinButton value={address.location ?? null} onChange={(location) => set({ location })} />
        ) : null}
      </section>
      <label className="card check-line">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Enregistrer cette adresse pour la prochaine fois
      </label>
      {lines.map((l) => (
        <div key={l.productId} className="summary-line">
          <span>
            {l.quantity} × {l.title}
          </span>
          <span>{formatXaf(l.price * l.quantity)}</span>
        </div>
      ))}
      <div className="summary-line">
        <strong>Articles</strong>
        <strong>{formatXaf(total)}</strong>
      </div>
      <SubmitButton testId="checkout-continue">Continuer vers le paiement</SubmitButton>
    </form>
  );
}

/**
 * « Votre porte sur la carte » (docs/ux/03 §16), facultatif : la position du téléphone, envoyée
 * dans des champs cachés. Le repère écrit reste obligatoire.
 */
function PinButton({
  value,
  onChange,
}: {
  value: Address['location'] | null;
  onChange: (value: Address['location'] | null) => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'denied' | 'failed'>('idle');
  const locate = () => {
    if (!('geolocation' in navigator)) return setState('failed');
    setState('busy');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setState('idle');
        onChange({
          lat: Math.round(coords.latitude * 1e6) / 1e6,
          lng: Math.round(coords.longitude * 1e6) / 1e6,
          accuracy: Math.round(coords.accuracy),
        });
      },
      (error) => setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'failed'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="pin">
      <strong>Votre porte sur la carte</strong>
      {value ? (
        <>
          <input type="hidden" name="lat" value={value.lat} />
          <input type="hidden" name="lng" value={value.lng} />
          {value.accuracy ? <input type="hidden" name="accuracy" value={value.accuracy} /> : null}
          <span className="small muted" data-testid="pin-saved">
            Position enregistrée{value.accuracy ? ` (à ${value.accuracy} m près)` : ''} : le livreur
            la verra sur sa carte.{' '}
            <button type="button" className="link" onClick={() => onChange(null)}>
              Retirer
            </button>
          </span>
        </>
      ) : (
        <>
          <span className="small muted">
            Facultatif : depuis chez vous, le livreur vous trouve plus vite et vous voyez quand il
            arrive.
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={locate}
            disabled={state === 'busy'}
            data-testid="pin-use"
          >
            {state === 'busy' ? 'Recherche de la position…' : 'Utiliser ma position actuelle'}
          </button>
          {state === 'denied' ? (
            <span className="small muted">Localisation refusée : le repère écrit suffit.</span>
          ) : null}
          {state === 'failed' ? (
            <span className="small muted">Position introuvable : le repère écrit suffit.</span>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Icônes dessinées à la main : pas de bibliothèque d'icônes dans le JavaScript de la page. */
function HomeIcon() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M3 9 4.5 4h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6" />
    </svg>
  );
}
