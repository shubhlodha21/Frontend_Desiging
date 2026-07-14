// Desk approval queue — the other half of the launch flow.
//
// The MD submits an intent from the order ticket; it lands here as PENDING and
// nothing happens until someone decides. Approve → the engine adopts it (~1s)
// and opens the position. Reject → terminal, the engine never sees it.
//
// Reached at ?admin=1 (see main.jsx). Built on her design system, same as the
// MD screen: zinc surfaces, hairline borders, tiny uppercase tracked labels,
// JetBrains Mono for every number. Colour is status only — amber = waiting,
// emerald = approved, red = rejected.
import { useCallback, useEffect, useRef, useState } from "react";
import { approveIntent, fetchIntents, rejectIntent } from "./lib/liveFeed.js";
import { Card, Label } from "./components/ui.jsx";
import { sileo, Toaster } from "sileo";

function notify(kind, title) {
  const fn = typeof sileo?.[kind] === "function" ? sileo[kind] : sileo?.success;
  try { fn?.({ title }); } catch { try { sileo?.success?.({ title }); } catch { /* noop */ } }
}

const SIDE_TONE = {
  LONG: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SHORT: "border-red-200 bg-red-50 text-red-700",
};
const STATUS_TONE = {
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  LAUNCHED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  PENDING_APPROVAL: "border-amber-300 bg-amber-100 text-amber-700",
};

// Price decimals follow the asset class, same rule as the engine and mdData.
const dp = (asset) => (asset === "FX" ? 4 : 2);

// `stop` is stored as a fraction (0.05 = 5% off the trigger).
const stopPct = (v) => `${(v * 100).toFixed(2)}%`;

function fmtWait(ms) {
  if (!Number.isFinite(ms)) return "0:00";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const _TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export default function AdminScreen() {
  const [intents, setIntents] = useState([]);
  const [online, setOnline] = useState(null); // null = unknown, then true/false
  const [busy, setBusy] = useState({});       // id → true while a decision is in flight
  const [rejecting, setRejecting] = useState(null); // id being rejected (shows reason input)
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(Date.now());
  const aliveRef = useRef(true);

  const pull = useCallback(async () => {
    try {
      const rows = await fetchIntents();
      if (!aliveRef.current) return;
      setIntents(rows);
      setOnline(true);
    } catch {
      if (!aliveRef.current) return;
      setOnline(false); // desk backend down — say so rather than showing a stale empty queue
    }
  }, []);

  // Poll every 3s; a /ws message pulls immediately so a fresh submit lands
  // without waiting out the interval.
  useEffect(() => {
    aliveRef.current = true;
    let ws;
    pull();
    const iv = setInterval(pull, 3000);
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = () => pull();
    } catch { /* no ws → the poll carries it */ }
    return () => {
      aliveRef.current = false;
      clearInterval(iv);
      try { ws && ws.close(); } catch { /* noop */ }
    };
  }, [pull]);

  // Drives the wait timers. Separate from the poll so they tick every second
  // without hammering the API.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function decide(intent, action, why) {
    setBusy((b) => ({ ...b, [intent.id]: true }));
    try {
      if (action === "approve") {
        await approveIntent(intent.id);
        notify("success", `Approved · ${intent.symbol}`);
      } else {
        await rejectIntent(intent.id, why);
        notify("warning", `Rejected · ${intent.symbol}`);
      }
      setRejecting(null);
      setReason("");
      await pull();
    } catch (e) {
      // 409 = already decided, almost always a second admin beating you to it.
      // Refetch so the queue shows the truth instead of a phantom row.
      if (e?.status === 409) {
        notify("info", `${intent.symbol} already decided elsewhere`);
        await pull();
      } else {
        notify("warning", `Failed · ${intent.symbol}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [intent.id]: false }));
    }
  }

  const pending = intents.filter((i) => i.status === "PENDING_APPROVAL");
  const decided = intents.filter((i) => i.status !== "PENDING_APPROVAL").slice(0, 12);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 font-mono text-[11px] font-bold text-white">GT</div>
          <div>
            <h1 className="text-[13px] font-semibold leading-none">Desk Approval</h1>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">Gautam Group · Admin</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              <span className={`h-1.5 w-1.5 rounded-full ${online === false ? "bg-red-500" : online ? "bg-emerald-500" : "bg-zinc-300"}`} />
              {online === false ? "Desk offline" : online ? "Live" : "Connecting"}
            </span>
            {pending.length > 0 && (
              <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-amber-700">
                {pending.length} waiting
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        {online === false && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-700">Backend unreachable</div>
            <p className="mt-1 font-mono text-[11px] text-red-600">
              Start it: <span className="text-red-800">uvicorn app.main:app --reload --port 8000</span>
            </p>
          </div>
        )}

        <Card
          title="Awaiting Approval"
          subtitle="Nothing is placed until you decide — approve opens the position, reject is final"
          right={<span className="font-mono text-[11px] tabular-nums text-zinc-400">{pending.length}</span>}
        >
          {pending.length === 0 ? (
            <p className="py-6 text-center font-mono text-[11px] text-zinc-400">
              {online === false ? "—" : "Queue is clear."}
            </p>
          ) : (
            <div className="space-y-2">
              {pending.map((i) => {
                const isRejecting = rejecting === i.id;
                const isBusy = !!busy[i.id];
                return (
                  <div key={i.id} className="rounded-xl border border-amber-300 bg-amber-50/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{i.symbol}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${SIDE_TONE[i.side] ?? ""}`}>
                        {i.side}
                      </span>
                      <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
                        {i.asset}
                      </span>
                      {i.paper && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-sky-700">
                          Paper
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-amber-700" title="time waiting">
                        {fmtWait(Date.parse(i.created_at))}
                      </span>
                    </div>

                    {/* The numbers that actually matter for the decision. */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label="Qty" value={i.qty.toLocaleString()} />
                      <Field label="Trigger" value={i.trigger.toFixed(dp(i.asset))} />
                      <Field label="Stop" value={stopPct(i.stop)} />
                      <Field label="Offset" value={i.offset == null ? "—" : String(i.offset)} />
                    </div>

                    <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-400">
                      by {i.submitted_by} · {_TIME.format(new Date(i.created_at))} GST
                    </div>

                    {isRejecting ? (
                      <div className="mt-3 space-y-2">
                        <Label>Reason (optional)</Label>
                        <input
                          autoFocus
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") decide(i, "reject", reason);
                            if (e.key === "Escape") { setRejecting(null); setReason(""); }
                          }}
                          placeholder="e.g. size over FX limit"
                          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-[12px] text-zinc-900 outline-none transition-colors focus:border-zinc-400"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setRejecting(null); setReason(""); }}
                            className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={isBusy}
                            onClick={() => decide(i, "reject", reason)}
                            className="flex-1 rounded-full bg-red-600 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                          >
                            {isBusy ? "Rejecting…" : "Confirm Reject"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <button
                          disabled={isBusy}
                          onClick={() => setRejecting(i.id)}
                          className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => decide(i, "approve")}
                          className="flex-1 rounded-full bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
                        >
                          {isBusy ? "Approving…" : "Approve"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Recent Decisions" subtitle="Audit trail — who decided what, and when">
          {decided.length === 0 ? (
            <p className="py-6 text-center font-mono text-[11px] text-zinc-400">No decisions yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {decided.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="text-[13px] font-semibold">{i.symbol}</span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {i.side} · {i.qty.toLocaleString()} @ {i.trigger.toFixed(dp(i.asset))}
                  </span>
                  {i.reject_reason && (
                    <span className="truncate font-mono text-[10px] text-red-600">“{i.reject_reason}”</span>
                  )}
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-400">
                    {i.decided_by ?? "—"} · {i.decided_at ? _TIME.format(new Date(i.decided_at)) : "—"}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATUS_TONE[i.status] ?? ""}`}>
                    {i.status === "LAUNCHED" ? "Launched" : i.status === "APPROVED" ? "Approved" : "Rejected"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* No auth yet — anyone who can reach this port can approve an order. */}
        <p className="pb-2 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
          Unauthenticated · add JWT roles before exposing this
        </p>
      </main>

      <Toaster position="top-center" theme="light" />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
      <div className="text-[8px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-zinc-900">{value}</div>
    </div>
  );
}
