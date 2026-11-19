import { useState } from 'react';
import { Empty } from './ui.jsx';
import { int, pct } from '../format.js';

/**
 * Magnitude of one series across categories: horizontal bars in the single validated
 * series hue, sorted by size, each labelled with its count and share in text ink (the
 * labels make it readable without color; the list itself is the table view). Hover or
 * focus shows the exact figure.
 *
 * @param {{ counts: Record<string, number>, total: number, format?: (key: string) => string, empty?: string, max?: number }} props
 */
export function BarList({ counts, total, format = (k) => k, empty = 'No data in this period', max = 8 }) {
  const [active, setActive] = useState(null);
  const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (entries.length === 0) return <Empty>{empty}</Empty>;
  // More categories than fit fold into "other" rather than a longer list.
  const shown = entries.length > max ? [...entries.slice(0, max - 1), ['other', entries.slice(max - 1).reduce((s, [, n]) => s + n, 0)]] : entries;
  const largest = Math.max(...shown.map(([, n]) => n), 1);

  return (
    <ul className="flex flex-col gap-2.5" aria-label="distribution">
      {shown.map(([key, n]) => {
        const name = key === 'other' && entries.length > max ? 'other' : format(key);
        const share = pct(n, total);
        return (
          <li
            key={key}
            tabIndex={0}
            className="group relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded outline-none"
            aria-label={`${name}: ${int(n)} turns, ${share}`}
            onMouseEnter={() => setActive(key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(key)}
            onBlur={() => setActive(null)}
          >
            <span className="truncate text-[13px] text-muted" title={name}>
              {name}
            </span>
            <span className="h-2.5 rounded-full bg-track">
              <span
                className={`block h-full rounded-full bg-series transition-opacity ${active && active !== key ? 'opacity-50' : ''}`}
                style={{ width: `${Math.max((n / largest) * 100, 2)}%` }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-ink">
              {int(n)} <span className="text-faint">{share}</span>
            </span>
            {active === key && (
              <span role="tooltip" className="pointer-events-none absolute -top-7 left-36 z-10 rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink shadow">
                {name}: {int(n)} of {int(total)} turns ({share})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
