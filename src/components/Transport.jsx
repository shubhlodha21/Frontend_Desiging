// The transport bar: prev / play-pause / next, speed presets, and a scrubber.
// It's a "dumb" component — it holds no state, it just calls the playback hook's
// controls and displays the tick it's told. All the logic lives in usePlayback.

const SPEEDS = [1, 2, 5, 10, 20];

export function Transport({ playback, timestamp }) {
  const { currentTick, isPlaying, speed, setSpeed, toggle, step, seek, totalTicks } = playback;
  const pct = totalTicks > 1 ? Math.round((currentTick / (totalTicks - 1)) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      {/* transport buttons */}
      <div className="flex items-center gap-1">
        <IconButton label="Previous" onClick={() => step(-1)}>⏮</IconButton>
        <button
          onClick={toggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-700"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <IconButton label="Next" onClick={() => step(1)}>⏭</IconButton>
      </div>

      {/* speed presets — her segmented pill group: a rounded-full tray of pills */}
      <div className="inline-flex gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
              speed === s ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* the scrubber — a range input styled with accent-color */}
      <input
        type="range"
        min={0}
        max={totalTicks - 1}
        value={currentTick}
        onChange={(e) => seek(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-zinc-900"
      />

      {/* readouts — mono + tabular so they don't shift while playing */}
      <div className="flex items-center gap-4 font-mono text-xs text-zinc-500">
        <span>
          TICK <span className="text-zinc-800">{currentTick}</span> / {totalTicks - 1}
        </span>
        <span>TS: {timestamp}</span>
        <span className="w-10 text-right text-zinc-800">{pct}%</span>
      </div>
    </div>
  );
}

function IconButton({ children, label, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
    >
      {children}
    </button>
  );
}
