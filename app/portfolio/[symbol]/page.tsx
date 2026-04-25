"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

const STORAGE_TRADES = "portfolio_trades_v2";
const STORAGE_PRICES = "portfolio_prices_v2";

type AssetType = "stock" | "option" | "crypto";

interface Trade {
  id: string;
  type: "buy" | "sell";
  symbol: string;
  name: string;
  assetType: AssetType;
  pricePerShare: number;   // always USD
  originalPrice?: number;
  originalCurrency?: "USD" | "HKD";
  shares: number;
  date: string;
}

interface ThesisData {
  thesis: string;
  whyBought: string;
  targetPrice: string;
  riskFactors: string;
  notes: string;
  updatedAt: string;
}

function getThesisKey(symbol: string) {
  return `portfolio_thesis_${symbol.toUpperCase()}`;
}

function loadThesis(symbol: string): ThesisData {
  try {
    const raw = localStorage.getItem(getThesisKey(symbol));
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { thesis: "", whyBought: "", targetPrice: "", riskFactors: "", notes: "", updatedAt: "" };
}

function saveThesis(symbol: string, data: ThesisData) {
  localStorage.setItem(
    getThesisKey(symbol),
    JSON.stringify({ ...data, updatedAt: new Date().toISOString() })
  );
}

export default function ThesisPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const upperSymbol = symbol.toUpperCase();

  const [thesis, setThesis] = useState<ThesisData>({
    thesis: "",
    whyBought: "",
    targetPrice: "",
    riskFactors: "",
    notes: "",
    updatedAt: "",
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ThesisData>(thesis);
  const [assetName, setAssetName] = useState(upperSymbol);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [saved, setSaved] = useState(false);

useEffect(() => {
  const loaded = loadThesis(upperSymbol);

  /* eslint-disable react-hooks/set-state-in-effect */
  setThesis(loaded);
  setDraft(loaded);
  setEditing(loaded.thesis === ""); // auto-open editor if empty
  /* eslint-enable react-hooks/set-state-in-effect */

  try {
    const allTrades: Trade[] = JSON.parse(localStorage.getItem(STORAGE_TRADES) ?? "[]");
    const symbolTrades = allTrades.filter((t) => t.symbol === upperSymbol);
    setTrades(symbolTrades);
    if (symbolTrades.length > 0) setAssetName(symbolTrades[0].name);
  } catch {
    // ignore
  }

  try {
    const prices: Record<string, number> = JSON.parse(localStorage.getItem(STORAGE_PRICES) ?? "{}");
    if (prices[upperSymbol]) setCurrentPrice(prices[upperSymbol]);
  } catch {
    // ignore
  }
}, [upperSymbol]);

  const handleSave = () => {
    saveThesis(upperSymbol, draft);
    setThesis({ ...draft, updatedAt: new Date().toISOString() });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCancel = () => {
    setDraft(thesis);
    setEditing(false);
  };

  // compute holding stats from trades (average cost method)
  let runningShares = 0;
  let runningCost = 0;
  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.type === "buy") {
      runningCost += t.pricePerShare * t.shares;
      runningShares += t.shares;
    } else {
      const avgBefore = runningShares > 0 ? runningCost / runningShares : 0;
      runningCost = Math.max(0, runningCost - avgBefore * t.shares);
      runningShares = Math.max(0, runningShares - t.shares);
    }
  }
  const totalShares = runningShares;
  const totalCost = runningCost;
  const avgPrice = totalShares > 0 ? totalCost / totalShares : 0;
  const pnl = currentPrice !== null ? (currentPrice - avgPrice) * totalShares : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-black to-slate-900 text-white">
      <div className="grid-background fixed inset-0 pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur border-b border-orange-500/20">
        <div className="max-w-4xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <Link href="/portfolio" className="text-orange-300 hover:text-orange-200">
            ← Portfolio
          </Link>
          <h1 className="text-xl md:text-2xl font-bold text-orange-400">
            {assetName} <span className="text-orange-300/60 text-lg">({upperSymbol})</span>
          </h1>
          <div className="w-20" />
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-8">

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Shares" value={totalShares > 0 ? totalShares.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"} />
          <StatCard label="Avg Cost" value={avgPrice > 0 ? `$${avgPrice.toFixed(4)}` : "—"} />
          <StatCard label="Current Price" value={currentPrice !== null ? `$${currentPrice.toFixed(4)}` : "—"} />
          <StatCard
            label="Net P&L"
            value={pnl !== null ? `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}` : "—"}
            color={pnl !== null ? (pnl >= 0 ? "text-green-400" : "text-red-400") : "text-gray-400"}
          />
        </div>

        {/* Thesis Card */}
        <section className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-orange-300">Investment Thesis</h2>
            {!editing && (
              <button
                onClick={() => { setDraft(thesis); setEditing(true); }}
                className="px-4 py-1.5 rounded-lg bg-orange-600/30 hover:bg-orange-600/60 text-orange-300 text-sm border border-orange-500/30 transition-colors"
              >
                ✏️ Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <Field
                label="Investment Thesis"
                placeholder="Why do you believe in this asset? What's the core thesis?"
                value={draft.thesis}
                onChange={(v) => setDraft((d) => ({ ...d, thesis: v }))}
                rows={5}
              />
              <Field
                label="Why I Bought"
                placeholder="What triggered this investment? Key catalysts?"
                value={draft.whyBought}
                onChange={(v) => setDraft((d) => ({ ...d, whyBought: v }))}
                rows={3}
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Target Price (optional)</label>
                <input
                  className="input-field w-full"
                  placeholder="e.g. $250"
                  value={draft.targetPrice}
                  onChange={(e) => setDraft((d) => ({ ...d, targetPrice: e.target.value }))}
                />
              </div>
              <Field
                label="Risk Factors"
                placeholder="What could go wrong? Key risks to monitor?"
                value={draft.riskFactors}
                onChange={(v) => setDraft((d) => ({ ...d, riskFactors: v }))}
                rows={3}
              />
              <Field
                label="Additional Notes"
                placeholder="Any other notes, links, or reminders..."
                value={draft.notes}
                onChange={(v) => setDraft((d) => ({ ...d, notes: v }))}
                rows={3}
              />
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold transition-colors"
                >
                  💾 Save Thesis
                </button>
                {thesis.thesis !== "" && (
                  <button
                    onClick={handleCancel}
                    className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-gray-300 font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {saved && <p className="text-green-400 text-sm text-center">✓ Saved successfully</p>}
            </div>
          ) : thesis.thesis ? (
            <div className="space-y-5">
              <ThesisSection title="Thesis" content={thesis.thesis} />
              {thesis.whyBought && <ThesisSection title="Why I Bought" content={thesis.whyBought} />}
              {thesis.targetPrice && <ThesisSection title="Target Price" content={thesis.targetPrice} />}
              {thesis.riskFactors && <ThesisSection title="Risk Factors" content={thesis.riskFactors} />}
              {thesis.notes && <ThesisSection title="Notes" content={thesis.notes} />}
              {thesis.updatedAt && (
                <p className="text-xs text-gray-600">
                  Last updated: {new Date(thesis.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              No thesis written yet. Click <strong className="text-orange-400">Edit</strong> to add one.
            </p>
          )}
        </section>

        {/* Trade History for this symbol */}
        {trades.length > 0 && (
          <section className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-orange-300 mb-4">Trade History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-slate-700 text-left">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4 text-right">Price / Share</th>
                    <th className="pb-3 pr-4 text-right">Shares</th>
                    <th className="pb-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {[...trades].reverse().map((t) => (
                    <tr key={t.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 pr-4 text-gray-400 text-xs">{t.date}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            t.type === "buy"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
                          }`}
                        >
                          {t.type === "buy" ? "BUY" : "SELL"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-200">${t.pricePerShare.toFixed(4)}</td>
                      <td className="py-3 pr-4 text-right text-gray-200">
                        {t.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="py-3 text-right text-gray-200">
                        ${(t.pricePerShare * t.shares).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color = "text-white" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800/50 border border-orange-500/20 rounded-xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ThesisSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-orange-300/80 mb-1">{title}</h3>
      <p className="text-gray-200 text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <textarea
        className="input-field w-full resize-none"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
