'use client';

import { useState } from 'react';
import { formatXaf } from '@/lib/format';
import { formatDay } from '@/lib/periods';

interface Day {
  date: string;
  orders: number;
  gmv: number;
}

const WIDTH = 760;
const HEIGHT = 220;
const MARGIN = { top: 22, right: 8, bottom: 26, left: 52 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** Graduation « ronde » : 1, 2 ou 5 × 10ⁿ, pour 4 intervalles au plus. */
function niceStep(max: number): number {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
}

/** 150000 → « 150 k » ; 2500000 → « 2,5 M ». */
const compact = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
    : n >= 1_000
      ? `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
      : String(n);

/** Colonne à bout arrondi (4 px), carrée sur la ligne de base. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Volume d'affaires par jour : une seule série (couleur de la marque, sans légende : le titre
 * la nomme), une colonne par jour, valeur du meilleur jour à son sommet, détail au survol et
 * au clavier. Le tableau des valeurs accompagne le graphique dans la page.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.gmv), 0);
  const step = niceStep(max || 1);
  const top = Math.ceil((max || 1) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = PLOT_W / days.length;
  const barW = Math.min(24, Math.max(band - 2, 1));
  const y = (v: number) => MARGIN.top + PLOT_H - (v / top) * PLOT_H;
  const best = days.findIndex((d) => d.gmv === max && max > 0);
  // Une étiquette de date sur ~5 jours, plus le dernier : jamais de chevauchement.
  const every = Math.max(1, Math.ceil(days.length / 7));
  const shown = days[active ?? -1];

  return (
    <div className="chart" onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Volume d'affaires par jour, en FCFA"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              className="chart-grid"
            />
            <text x={MARGIN.left - 8} y={y(t)} className="chart-axis" textAnchor="end" dy="0.32em">
              {compact(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = MARGIN.left + i * band;
          const h = (d.gmv / top) * PLOT_H;
          const label = `${formatDay(d.date)} : ${formatXaf(d.gmv)}, ${d.orders} commande${d.orders > 1 ? 's' : ''}`;
          return (
            <g key={d.date}>
              {h > 0 ? (
                <path
                  d={column(x + (band - barW) / 2, y(d.gmv), barW, h)}
                  className={`chart-bar ${active === i ? 'active' : ''}`}
                />
              ) : null}
              {i === best ? (
                <text x={x + band / 2} y={y(d.gmv) - 6} className="chart-value" textAnchor="middle">
                  {compact(d.gmv)}
                </text>
              ) : null}
              {i % every === 0 || i === days.length - 1 ? (
                <text x={x + band / 2} y={HEIGHT - 8} className="chart-axis" textAnchor="middle">
                  {Number(d.date.slice(8))}
                </text>
              ) : null}
              {/* Zone de survol : toute la largeur du jour, plus grande que la colonne. */}
              <rect
                x={x}
                y={MARGIN.top}
                width={band}
                height={PLOT_H}
                className="chart-hit"
                tabIndex={0}
                aria-label={label}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          );
        })}
        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={MARGIN.top + PLOT_H}
          y2={MARGIN.top + PLOT_H}
          className="chart-baseline"
        />
      </svg>
      {shown && active !== null ? (
        <div
          className="chart-tooltip"
          role="status"
          style={{
            left: `${((MARGIN.left + (active + 0.5) * band) / WIDTH) * 100}%`,
            top: `${(y(shown.gmv) / HEIGHT) * 100}%`,
            // Près des bords, la bulle s'ouvre vers l'intérieur au lieu de déborder.
            translate:
              active > days.length * 0.8
                ? '-100% 0'
                : active < days.length * 0.2
                  ? '0 0'
                  : '-50% 0',
          }}
        >
          <strong>{formatXaf(shown.gmv)}</strong>
          <span>
            {shown.orders} commande{shown.orders > 1 ? 's' : ''}
          </span>
          <span className="muted">{formatDay(shown.date)}</span>
        </div>
      ) : null}
    </div>
  );
}
