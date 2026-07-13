// Small shared UI primitives. In the original these are the repeated "card" and
// number-formatting patterns that give every panel the same calm, consistent look.

// The signature container: white surface, hairline zinc border, soft rounding.
export function Card({ title, subtitle, right, children }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            {/* HER micro-typography: tiny, bold, uppercase, wide-tracked */}
            <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// Color gains/losses from the theme tokens; mono + tabular-nums keeps them steady.
export function Money({ value }) {
  const cls = value >= 0 ? "text-[color:var(--color-up)]" : "text-[color:var(--color-down)]";
  return (
    <span className={`font-mono font-medium ${cls}`}>
      {value >= 0 ? "+" : ""}
      {value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
}

// The toggle-chip, now using HER exact pill recipe: rounded-full, hairline
// border, micro-typography, hover darkens the border+text. Active = solid zinc.
export function Chip({ active, children, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

// A segmented pill group — her `inline-flex rounded-full bg-zinc-50 p-1` wrapper
// that holds Chips (used for speed presets, resolution toggles, etc.).
export function ChipGroup({ children }) {
  return <div className="inline-flex gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-1">{children}</div>;
}

export function Stat({ label, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className="mt-1 text-lg">{children}</div>
    </div>
  );
}

// Her tiny letter-spaced section label (the "PRODUCT", "DAY" row labels).
export function Label({ children }) {
  return <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{children}</span>;
}
