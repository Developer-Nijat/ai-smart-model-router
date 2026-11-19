import { Fragment } from 'react';

// Small shadcn/ui-style building blocks, written here rather than generated: the
// dashboard needs a handful, all styled by the role tokens in index.css.

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

const BUTTON = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-line bg-surface-2 text-ink hover:bg-track',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'border border-line text-critical hover:bg-surface-2',
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

const TONES = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-surface-2 text-accent',
  good: 'bg-surface-2 text-good',
  warning: 'bg-surface-2 text-warning',
  critical: 'bg-surface-2 text-critical',
};

export function Badge({ tone = 'neutral', children }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] ${TONES[tone]}`}>{children}</span>;
}

/** A decision status as a word plus a tone: never color alone. */
export function StatusBadge({ status }) {
  const tone = { applied: 'good', recommended: 'accent', skipped: 'neutral', unsupported: 'warning', failed: 'critical' }[status] ?? 'neutral';
  return <Badge tone={tone}>{status ?? '—'}</Badge>;
}

export function Select({ label, value, onChange, options, className = '' }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs text-muted ${className}`}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
      >
        {options.map((option) => {
          const [val, text] = Array.isArray(option) ? option : [option, option];
          return (
            <option key={val} value={val}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}

/** `detail(row)` adds a full-width row under a row when it returns something. */
export function Table({ columns, rows, empty = 'No data yet', rowKey, detail }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-faint">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const extra = detail?.(row);
            return (
              <Fragment key={rowKey ? rowKey(row) : i}>
                <tr className="border-b border-line last:border-0 hover:bg-surface-2">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2 align-top ${c.align === 'right' ? 'text-right font-mono tabular-nums' : ''} ${c.className ?? ''}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
                {extra && (
                  <tr className="border-b border-line">
                    <td colSpan={columns.length} className="px-4 pb-3">
                      {extra}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="py-6 text-center text-[13px] text-faint">{children}</p>;
}

export function Notice({ tone = 'neutral', children }) {
  const border = { neutral: 'border-line', critical: 'border-critical', good: 'border-good', warning: 'border-warning' }[tone];
  return <div className={`rounded-md border ${border} bg-surface-2 px-3 py-2 text-[13px] text-ink`} role={tone === 'critical' ? 'alert' : 'status'}>{children}</div>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
