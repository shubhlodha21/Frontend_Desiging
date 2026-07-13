import { useCallback, useEffect, useRef, useState } from "react";

// ────────────────────────────────────────────────────────────────────────────
// THE PLAYBACK ENGINE — the heart of the whole dashboard.
//
// It owns ONE number: `currentTick`. Everything on screen (charts, order book,
// stats, tooltip) reads from it. Press play and this hook advances that number
// on a timer; the rest of the UI just re-renders. That single-source-of-truth is
// exactly the "it all works together" feeling you were admiring.
//
// The original drives this with requestAnimationFrame + isPlaying + playbackSpeed
// (confirmed in the real bundle). rAF (not setInterval) = smooth, and it pauses
// automatically when the browser tab is hidden.
// ────────────────────────────────────────────────────────────────────────────
export function usePlayback(totalTicks, { ticksPerSecond = 30 } = {}) {
  const [currentTick, setCurrentTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 1x, 2x, 5x, 10x, 20x

  // Refs let the animation loop read the latest values WITHOUT restarting itself.
  const tickRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  useEffect(() => void (tickRef.current = currentTick), [currentTick]);
  useEffect(() => void (playingRef.current = isPlaying), [isPlaying]);
  useEffect(() => void (speedRef.current = speed), [speed]);

  // One rAF loop for the component's whole life. `acc` accumulates fractional
  // ticks so playback speed is smooth and frame-rate independent.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let acc = 0;

    function frame(now) {
      if (last && playingRef.current) {
        acc += ((now - last) / 1000) * ticksPerSecond * speedRef.current;
        if (acc >= 1) {
          const advance = Math.floor(acc);
          acc -= advance;
          const next = Math.min(tickRef.current + advance, totalTicks - 1);
          if (next !== tickRef.current) setCurrentTick(next);
          if (next >= totalTicks - 1) setIsPlaying(false); // stop at the end
        }
      } else {
        acc = 0;
      }
      last = now;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [totalTicks, ticksPerSecond]);

  // Controls the transport bar will call.
  const play = useCallback(() => {
    // If we're parked at the end, pressing play restarts from the top.
    setCurrentTick((t) => (t >= totalTicks - 1 ? 0 : t));
    setIsPlaying(true);
  }, [totalTicks]);
  const pause = useCallback(() => setIsPlaying(false), []);
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [play, pause]);
  const step = useCallback(
    (delta) => {
      setIsPlaying(false);
      setCurrentTick((t) => Math.max(0, Math.min(t + delta, totalTicks - 1)));
    },
    [totalTicks],
  );
  const seek = useCallback(
    (tick) => setCurrentTick(Math.max(0, Math.min(tick, totalTicks - 1))),
    [totalTicks],
  );

  return { currentTick, isPlaying, speed, setSpeed, play, pause, toggle, step, seek, totalTicks };
}
