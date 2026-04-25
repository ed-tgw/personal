"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

type AssetType = "stock" | "option" | "crypto";
type TradeCurrency = "USD" | "HKD";
type HoldingsSortKey = "currentValue" | "costBasis" | "netPnl";
type SortDirection = "asc" | "desc";

interface Trade {
  id: string;
  type: "buy" | "sell";
  symbol: string;
  name: string;
  assetType: AssetType;
  pricePerShare: number;       // always stored in USD
  originalPrice: number;       // price as entered by user, in originalCurrency
  originalCurrency: TradeCurrency;
  shares: number;
  date: string;
}

const FALLBACK_HKD_RATE = 1 / 7.80; // ~0.1282, used before live rate is fetched

interface Holding {
  symbol: string;
  name: string;
  assetType: AssetType;
  totalShares: number;
  totalCost: number; // sum of (price * shares) for all buys - (avgPrice * shares) for sells
  avgPrice: number; // totalCost / totalShares
  currentPrice: number;
  previousClose: number;
}

interface WishlistItem {
  id: string;
  symbol: string;
  allocationPct: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_TRADES = "portfolio_trades_v2";
const STORAGE_HOLDINGS = "portfolio_holdings_v2";
const STORAGE_PRICES = "portfolio_prices_v2";
const STORAGE_CURRENCIES = "portfolio_prices_currency_v2";
const STORAGE_WISHLIST = "portfolio_wishlist_v1";

const PIE_COLORS = [
  "#f97316", "#fb923c", "#fdba74", "#fcd34d", "#a3e635",
  "#34d399", "#22d3ee", "#818cf8", "#c084fc", "#f472b6",
  "#ef4444", "#84cc16", "#06b6d4", "#6366f1", "#ec4899",
];

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: "Stock",
  option: "Option",
  crypto: "Crypto",
};

// ─── Utility helpers ─────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Recompute all holdings from the current list of trades */
function computeHoldings(trades: Trade[]): Holding[] {
  const map = new Map<
    string,
    { symbol: string; name: string; assetType: AssetType; totalShares: number; totalCost: number }
  >();

  for (const t of trades) {
    const key = t.symbol.toUpperCase();
    if (!map.has(key)) {
      map.set(key, { symbol: key, name: t.name, assetType: t.assetType, totalShares: 0, totalCost: 0 });
    }
    const h = map.get(key)!;
    if (t.type === "buy") {
      h.totalCost += t.pricePerShare * t.shares;
      h.totalShares += t.shares;
    } else {
      // sell: reduce cost proportionally (average cost method)
      if (h.totalShares > 0) {
        const avgBefore = h.totalCost / h.totalShares;
        const soldCost = avgBefore * t.shares;
        h.totalCost = Math.max(0, h.totalCost - soldCost);
        h.totalShares = Math.max(0, h.totalShares - t.shares);
      }
    }
    // keep latest name
    h.name = t.name;
  }

  return Array.from(map.values())
    .filter((h) => h.totalShares > 0.0001)
    .map((h) => ({
      ...h,
      avgPrice: h.totalShares > 0 ? h.totalCost / h.totalShares : 0,
      currentPrice: 0,
      previousClose: 0,
    }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Company logo with fallback initials */
function AssetLogo({
  symbol,
  assetType,
  size = 40,
}: {
  symbol: string;
  assetType: AssetType;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  const logoUrl =
    assetType === "crypto"
      ? `https://assets.parqet.com/logos/crypto/${symbol.toLowerCase()}`
      : `https://assets.parqet.com/logos/symbol/${symbol.toUpperCase()}`;

  const initials = symbol.slice(0, 2).toUpperCase();
  const hue = symbol
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full font-bold text-white select-none"
        style={{
          width: size,
          height: size,
          background: `hsl(${hue},65%,45%)`,
          fontSize: size * 0.3,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full object-contain"
      style={{ width: size, height: size, flexShrink: 0, background: "white" }}
      onError={() => setFailed(true)}
    />
  );
}

function FmtNeutral({ val, decimals = 2 }: { val: number; decimals?: number }) {
return (
<span>
${val.toLocaleString("en-US", {
minimumFractionDigits: decimals,
maximumFractionDigits: decimals,
})}
</span>
);
}

type EnrichedHolding = Holding & { currentPrice: number; pnl: number };

/** Holdings bubble chart */
function HoldingsBubbles({
  enrichedHoldings,
}: {
  enrichedHoldings: EnrichedHolding[];
}) {
  const enriched = enrichedHoldings.map((h) => ({
    ...h,
    // Fall back to cost basis if no live price yet
    value: h.currentPrice > 0 ? h.currentPrice * h.totalShares : h.avgPrice * h.totalShares,
  }));

  const maxValue = Math.max(...enriched.map((h) => h.value), 1);

  return (
    <div className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-orange-300 mb-4">Holdings Overview</h2>
      {enriched.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No holdings yet. Add your first trade.</p>
      ) : (
        <div className="flex flex-wrap gap-4 items-end justify-center py-4">
          {enriched
            .sort((a, b) => b.value - a.value)
            .map((h) => {
              const ratio = h.value / maxValue;
              const diameter = Math.max(70, Math.min(160, 70 + ratio * 90));
              const pnl = h.pnl;
              const pnlPct =
                h.currentPrice > 0 && h.avgPrice > 0
                  ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100
                  : 0;
              const isGain = pnl >= 0;

              return (
                <div key={h.symbol} className="flex flex-col items-center gap-1">
                  <div
                    className={`rounded-full flex flex-col items-center justify-center border-2 transition-transform hover:scale-105 cursor-default ${
                      isGain
                        ? "border-green-500/50 bg-green-900/20"
                        : "border-red-500/50 bg-red-900/20"
                    }`}
                    style={{ width: diameter, height: diameter }}
                    title={`${h.name} (${h.symbol})\nValue: $${h.value.toFixed(2)}\nP&L: ${isGain ? "+" : ""}$${pnl.toFixed(2)} (${isGain ? "+" : ""}${pnlPct.toFixed(1)}%)`}
                  >
                    <AssetLogo symbol={h.symbol} assetType={h.assetType} size={Math.max(24, diameter * 0.32)} />
                    <span className="text-xs font-bold text-white mt-1">{h.symbol}</span>
                    <span
                      className={`text-xs font-semibold ${isGain ? "text-green-400" : "text-red-400"}`}
                    >
                      {isGain ? "+" : ""}{pnlPct.toFixed(1)}%
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    ${h.value >= 1000 ? `${(h.value / 1000).toFixed(1)}k` : h.value.toFixed(0)}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Portfolio pie chart */
function PortfolioPieChart({
  enrichedHoldings,
}: {
  enrichedHoldings: EnrichedHolding[];
}) {
  const data = enrichedHoldings
    .map((h) => ({
      name: h.symbol,
      // Use cost basis if live price not yet available
      value: h.currentPrice > 0 ? h.currentPrice * h.totalShares : h.avgPrice * h.totalShares,
    }))
    .filter((d) => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6 flex items-center justify-center min-h-[260px]">
        <p className="text-gray-500">No data to display.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-orange-300 mb-2">Portfolio Allocation</h2>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="35%"
            outerRadius="65%"
            paddingAngle={2}
            dataKey="value"
            label={({ name, value }) =>
              `${name} ${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%`
            }
            labelLine={false}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => {
              const num = typeof value === "number" ? value : parseFloat(String(value ?? 0));
              return [
                `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${total > 0 ? ((num / total) * 100).toFixed(1) : 0}%)`,
                "Value",
              ];
            }}
            contentStyle={{ background: "#1e293b", border: "1px solid #f97316", borderRadius: 8, color: "#f1f5f9" }}
          />
          <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Modal Components ─────────────────────────────────────────────────────────

interface TradeFormData {
  symbol: string;
  name: string;
  assetType: AssetType;
  pricePerShare: string;
  shares: string;
  date: string;
}

function TradeModal({
  mode,
  onClose,
  onSubmit,
  existingHoldings,
  hkdRate,
}: {
  mode: "buy" | "sell";
  onClose: () => void;
  onSubmit: (t: Omit<Trade, "id" | "type">) => void;
  existingHoldings: Holding[];
  hkdRate: number;
}) {
  const [form, setForm] = useState<TradeFormData>({
    symbol: "",
    name: "",
    assetType: "stock",
    pricePerShare: "",
    shares: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [currency, setCurrency] = useState<TradeCurrency>("USD");
  const [error, setError] = useState("");

  const handleSymbolChange = (sym: string) => {
    const upper = sym.toUpperCase();
    const existing = existingHoldings.find((h) => h.symbol === upper);
    setForm((f) => ({
      ...f,
      symbol: upper,
      name: existing ? existing.name : f.name,
      assetType: existing ? existing.assetType : f.assetType,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = form.symbol.trim().toUpperCase();
    const name = form.name.trim();
    const price = parseFloat(form.pricePerShare);
    const shares = parseFloat(form.shares);

    if (!sym) return setError("Symbol is required.");
    if (!name) return setError("Name is required.");
    if (isNaN(price) || price <= 0) return setError("Invalid price.");
    if (isNaN(shares) || shares <= 0) return setError("Invalid number of shares.");

    if (mode === "sell") {
      const holding = existingHoldings.find((h) => h.symbol === sym);
      if (!holding) return setError(`You don't hold ${sym}.`);
      if (shares > holding.totalShares) return setError(`You only hold ${holding.totalShares} shares of ${sym}.`);
    }

    // Convert to USD if entered in HKD
    const priceUSD =
      currency === "HKD" && hkdRate > 0 ? price * hkdRate : price;

    setError("");
    onSubmit({
      symbol: sym,
      name,
      assetType: form.assetType,
      pricePerShare: priceUSD,
      originalPrice: price,
      originalCurrency: currency,
      shares,
      date: form.date,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-orange-500/40 rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-2xl font-bold text-orange-400 mb-6">
          {mode === "buy" ? "📈 New Purchase" : "📉 New Sale"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Symbol *</label>
              <input
                className="input-field w-full uppercase"
                placeholder="e.g. AAPL"
                value={form.symbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Asset Type</label>
              <select
                className="input-field w-full"
                value={form.assetType}
                onChange={(e) => setForm((f) => ({ ...f, assetType: e.target.value as AssetType }))}
              >
                <option value="stock">Stock</option>
                <option value="option">Option</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Company / Asset Name *</label>
            <input
              className="input-field w-full"
              placeholder="e.g. Apple Inc."
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          {/* Currency selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Price Currency</label>
            <div className="flex rounded-lg overflow-hidden border border-orange-500/30">
              {(["USD", "HKD"] as TradeCurrency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    currency === c
                      ? "bg-orange-600 text-white"
                      : "bg-slate-800 text-gray-400 hover:bg-slate-700"
                  }`}
                >
                  {c === "USD" ? "🇺🇸 USD" : "🇭🇰 HKD"}
                </button>
              ))}
            </div>
            {currency === "HKD" && hkdRate > 0 && form.pricePerShare && !isNaN(parseFloat(form.pricePerShare)) && (
              <p className="text-xs text-gray-500 mt-1">
                ≈ USD ${(parseFloat(form.pricePerShare) * hkdRate).toFixed(4)} (rate: 1 HKD = ${hkdRate.toFixed(4)})
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {mode === "buy" ? "Purchase Price" : "Sale Price"} per Share ({currency}) *
              </label>
              <input
                className="input-field w-full"
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.00"
                value={form.pricePerShare}
                onChange={(e) => setForm((f) => ({ ...f, pricePerShare: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Number of Shares *</label>
              <input
                className="input-field w-full"
                type="number"
                step="0.0001"
                min="0"
                placeholder="0"
                value={form.shares}
                onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              className="input-field w-full"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className={`flex-1 py-2 rounded-xl font-semibold transition-colors ${
                mode === "buy"
                  ? "bg-green-600 hover:bg-green-500 text-white"
                  : "bg-red-600 hover:bg-red-500 text-white"
              }`}
            >
              {mode === "buy" ? "Add Purchase" : "Add Sale"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-gray-300 font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesCurrency, setPricesCurrency] = useState<Record<string, string>>({});
  const [hkdRate, setHkdRate] = useState(FALLBACK_HKD_RATE);
  const [priceLoading, setPriceLoading] = useState(false);
  const [modal, setModal] = useState<"buy" | "sell" | null>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null); // symbol being edited
  const [editPriceDraft, setEditPriceDraft] = useState("");
  const [showSummaryHKD, setShowSummaryHKD] = useState(false);
  const [showCurrentValueHKD, setShowCurrentValueHKD] = useState(false);
  const [showCostBasisHKD, setShowCostBasisHKD] = useState(false);
  const [showNetPnlHKD, setShowNetPnlHKD] = useState(false);
  const [holdingsSortKey, setHoldingsSortKey] = useState<HoldingsSortKey | null>(null);
  const [holdingsSortDirection, setHoldingsSortDirection] = useState<SortDirection>("desc");
  const [tradesDateSortDirection, setTradesDateSortDirection] = useState<SortDirection>("desc");
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [wishlistSymbol, setWishlistSymbol] = useState("");
  const [wishlistAllocation, setWishlistAllocation] = useState("");
  const [wishlistError, setWishlistError] = useState("");
  const [mounted, setMounted] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());

  // ── Load from localStorage after mount ──────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      // Migrate old trades that lack originalPrice / originalCurrency
      const raw = JSON.parse(localStorage.getItem(STORAGE_TRADES) ?? "[]") as Partial<Trade>[];
      const savedTrades: Trade[] = raw.map((t) => ({
        originalCurrency: "USD" as TradeCurrency,
        originalPrice: t.pricePerShare ?? 0,
        ...t,
      } as Trade));
      const savedPrices: Record<string, number> = JSON.parse(localStorage.getItem(STORAGE_PRICES) ?? "{}");
      const savedCurrencies: Record<string, string> = JSON.parse(localStorage.getItem(STORAGE_CURRENCIES) ?? "{}");
      const savedWishlist: WishlistItem[] = JSON.parse(localStorage.getItem(STORAGE_WISHLIST) ?? "[]");
      setTrades(savedTrades);
      setPrices(savedPrices);
      setPricesCurrency(savedCurrencies);
      setWishlist(savedWishlist);
      setHoldings(computeHoldings(savedTrades));
    } catch {
      // ignore parse errors
    }
  }, []);

  // ── Persist trades ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_TRADES, JSON.stringify(trades));
    const computed = computeHoldings(trades);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoldings(computed);
    localStorage.setItem(STORAGE_HOLDINGS, JSON.stringify(computed));
  }, [trades, mounted]);

  // ── Persist prices + currencies ─────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_PRICES, JSON.stringify(prices));
  }, [prices, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_CURRENCIES, JSON.stringify(pricesCurrency));
  }, [pricesCurrency, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_WISHLIST, JSON.stringify(wishlist));
  }, [wishlist, mounted]);

  // ── Fetch live prices for all holdings ──────────────────────────────────
  const fetchPrices = useCallback(async (symbolList: string[]) => {
    if (symbolList.length === 0) return;
    setPriceLoading(true);
    const results: Record<string, number> = {};
    const currencies: Record<string, string> = {};
    await Promise.allSettled(
      symbolList.map(async (sym) => {
        try {
          const r = await fetch(`/api/stock-price?symbol=${encodeURIComponent(sym)}`);
          if (r.ok) {
            const d = await r.json();
            if (d.price) results[sym] = d.price;
            if (d.currency) currencies[sym] = d.currency;
            // Capture HKD/USD rate from the HKDUSD=X quote
            if (sym === "HKDUSD=X" && d.price > 0) setHkdRate(d.price);
          }
        } catch {
          // ignore individual failures
        }
      })
    );
    setPrices((prev) => ({ ...prev, ...results }));
    setPricesCurrency((prev) => ({ ...prev, ...currencies }));
    setPriceLoading(false);
  }, []);

  // ── Fetch HKD/USD exchange rate on mount ────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    if (!fetchedRef.current.has("HKDUSD=X")) {
      fetchedRef.current.add("HKDUSD=X");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPrices(["HKDUSD=X"]);
    }
  }, [mounted, fetchPrices]);

  useEffect(() => {
    if (!mounted) return;
    const symbols = holdings.map((h) => h.symbol).filter((s) => !fetchedRef.current.has(s));
    if (symbols.length > 0) {
      symbols.forEach((s) => fetchedRef.current.add(s));
      fetchPrices(symbols);
    }
  }, [holdings, mounted, fetchPrices]);

  // ── Trade handlers ───────────────────────────────────────────────────────
  const addTrade = (type: "buy" | "sell") => (data: Omit<Trade, "id" | "type">) => {
    const trade: Trade = { id: generateId(), type, ...data };
    setTrades((prev) => [...prev, trade]);
    // fetch price for new symbol
    if (!fetchedRef.current.has(data.symbol)) {
      fetchedRef.current.add(data.symbol);
      fetchPrices([data.symbol]);
    }
  };

  const deleteTrade = (id: string) => {
    if (!confirm("Delete this trade?")) return;
    setTrades((prev) => prev.filter((t) => t.id !== id));
  };

  const refreshPrices = () => {
    fetchedRef.current.clear();
    const symbols = ["HKDUSD=X", ...holdings.map((h) => h.symbol)];
    symbols.forEach((s) => fetchedRef.current.add(s));
    fetchPrices(symbols);
  };

  const addWishlistItem = () => {
    const symbol = wishlistSymbol.trim().toUpperCase();
    const allocation = parseFloat(wishlistAllocation);

    if (!symbol) {
      setWishlistError("Please enter a stock symbol.");
      return;
    }
    if (isNaN(allocation) || allocation <= 0) {
      setWishlistError("Please enter a valid allocation greater than 0%.");
      return;
    }

    setWishlist((prev) => {
      const existing = prev.find((item) => item.symbol === symbol);
      if (existing) {
        return prev.map((item) =>
          item.symbol === symbol ? { ...item, allocationPct: allocation } : item
        );
      }
      return [...prev, { id: generateId(), symbol, allocationPct: allocation }];
    });

    setWishlistError("");
    setWishlistSymbol("");
    setWishlistAllocation("");
  };

  const removeWishlistItem = (id: string) => {
    setWishlist((prev) => prev.filter((item) => item.id !== id));
  };

  // ── Enrich holdings: convert live prices to USD where needed ────────────
  const enrichedHoldings: EnrichedHolding[] = holdings.map((h) => {
    const rawPrice = prices[h.symbol] ?? 0;
    const liveCurrency = pricesCurrency[h.symbol] ?? "USD";
    // Convert HKD live price to USD
    const cp = liveCurrency === "HKD" && hkdRate > 0 ? rawPrice * hkdRate : rawPrice;
    const pnl = cp > 0 ? (cp - h.avgPrice) * h.totalShares : 0;
    return { ...h, currentPrice: cp, pnl };
  });

  const totalValue = enrichedHoldings.reduce((s, h) => s + h.currentPrice * h.totalShares, 0);
  const totalCost = enrichedHoldings.reduce((s, h) => s + h.totalCost, 0);
  const netPnl = totalValue - totalCost;
  const netPnlPct = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
  const totalValueDisplay = showSummaryHKD && hkdRate > 0 ? totalValue / hkdRate : totalValue;
  const totalCostDisplay = showSummaryHKD && hkdRate > 0 ? totalCost / hkdRate : totalCost;
  const summaryPrefix = showSummaryHKD ? "HK$" : "$";

  const toggleHoldingsSort = (key: HoldingsSortKey) => {
    if (holdingsSortKey === key) {
      setHoldingsSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setHoldingsSortKey(key);
    setHoldingsSortDirection("desc");
  };

  const sortedHoldings = [...enrichedHoldings].sort((a, b) => {
    if (!holdingsSortKey) return 0;
    const currentValueA = a.currentPrice > 0 ? a.currentPrice * a.totalShares : 0;
    const currentValueB = b.currentPrice > 0 ? b.currentPrice * b.totalShares : 0;
    const costBasisA = a.avgPrice * a.totalShares;
    const costBasisB = b.avgPrice * b.totalShares;

    let aValue = 0;
    let bValue = 0;

    if (holdingsSortKey === "currentValue") {
      aValue = currentValueA;
      bValue = currentValueB;
    } else if (holdingsSortKey === "costBasis") {
      aValue = costBasisA;
      bValue = costBasisB;
    } else {
      aValue = a.pnl;
      bValue = b.pnl;
    }

    const direction = holdingsSortDirection === "asc" ? 1 : -1;
    return (aValue - bValue) * direction;
  });

  const sortedTrades = [...trades].sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    const direction = tradesDateSortDirection === "asc" ? 1 : -1;
    return (aTime - bTime) * direction;
  });

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-black to-slate-900 text-white">
      <div className="grid-background fixed inset-0 pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur border-b border-orange-500/20">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="text-orange-300 hover:text-orange-200 text-xl">
            ← Hub
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-400 bg-clip-text text-transparent">
            📊 Investment Portfolio
          </h1>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={refreshPrices}
              disabled={priceLoading}
              className="text-xs px-3 py-1.5 rounded-lg bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/30 transition-colors disabled:opacity-50"
            >
              {priceLoading ? "Fetching…" : "↻ Refresh Prices"}
            </button>
            <span className="text-xs text-gray-500">1 HKD = ${hkdRate.toFixed(4)} USD</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label={`Total Value (${showSummaryHKD ? "HKD" : "USD"})`}
            value={`${summaryPrefix}${totalValueDisplay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            action={
              <button
                onClick={() => setShowSummaryHKD((prev) => !prev)}
                className="text-[11px] text-gray-400 hover:text-orange-300 transition-colors"
                title="Toggle Total Value and Total Cost between USD and HKD"
              >
                Toggle {showSummaryHKD ? "USD" : "HKD"}
              </button>
            }
          />
          <SummaryCard
            label={`Total Cost (${showSummaryHKD ? "HKD" : "USD"})`}
            value={`${summaryPrefix}${totalCostDisplay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          />
          <SummaryCard
            label="Net Gain / Loss"
            value={`${netPnl >= 0 ? "+" : ""}$${Math.abs(netPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            color={netPnl >= 0 ? "text-green-400" : "text-red-400"}
          />
          <SummaryCard
            label="Return"
            value={`${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(2)}%`}
            color={netPnlPct >= 0 ? "text-green-400" : "text-red-400"}
          />
        </div>

        {/* Holdings Overview */}
        <HoldingsBubbles enrichedHoldings={enrichedHoldings} />

        {/* Portfolio Allocation + Wishlist */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <PortfolioPieChart enrichedHoldings={enrichedHoldings} />

          <section className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-orange-300 mb-4">Wishlist</h2>

            <form
              className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4"
              onSubmit={(e) => {
                e.preventDefault();
                addWishlistItem();
              }}
            >
              <input
                className="input-field"
                placeholder="Stock Symbol (e.g. NVDA)"
                value={wishlistSymbol}
                onChange={(e) => {
                  setWishlistSymbol(e.target.value.toUpperCase());
                  if (wishlistError) setWishlistError("");
                }}
              />
              <input
                className="input-field"
                type="number"
                min="0"
                step="0.01"
                placeholder="Preferred Allocation %"
                value={wishlistAllocation}
                onChange={(e) => {
                  setWishlistAllocation(e.target.value);
                  if (wishlistError) setWishlistError("");
                }}
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold transition-colors"
              >
                + Add Wishlist Item
              </button>
            </form>

            {wishlistError && <p className="text-sm text-red-400 mb-3">{wishlistError}</p>}

            {wishlist.length === 0 ? (
              <p className="text-gray-500 text-center py-6">No wishlist items yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-slate-700 text-left">
                      <th className="pb-3 pr-4">Symbol</th>
                      <th className="pb-3 pr-4 text-right">Preferred Allocation</th>
                      <th className="pb-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {wishlist.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="py-3 pr-4 font-semibold text-white">{item.symbol}</td>
                        <td className="py-3 pr-4 text-right text-gray-200">{item.allocationPct.toFixed(2)}%</td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => removeWishlistItem(item.id)}
                            className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Table A – Holdings */}
        <section className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-orange-300">
              Table A — Holdings
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => setModal("buy")}
                className="px-4 py-2 rounded-xl bg-green-700 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
              >
                + New Purchase
              </button>
              <button
                onClick={() => setModal("sell")}
                className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
              >
                − New Sale
              </button>
            </div>
          </div>

          {enrichedHoldings.length === 0 ? (
            <p className="text-gray-500 text-center py-10">
              No holdings yet. Click <strong className="text-orange-400">+ New Purchase</strong> to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-slate-700 text-left">
                    <th className="pb-3 pr-4">Asset</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4 text-right">Avg Cost</th>
                    <th className="pb-3 pr-4 text-right">Shares</th>
                    <th className="pb-3 pr-4 text-right">Current Price</th>
                    <th className="pb-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setShowCurrentValueHKD((prev) => !prev)}
                          className="text-gray-300 hover:text-orange-300 transition-colors"
                          title="Toggle Current Value between USD and HKD"
                        >
                          Current Value ({showCurrentValueHKD ? "HKD" : "USD"})
                        </button>
                        <button
                          onClick={() => toggleHoldingsSort("currentValue")}
                          className="text-gray-400 hover:text-orange-300 transition-colors"
                          title="Sort Current Value"
                        >
                          {holdingsSortKey === "currentValue" ? (holdingsSortDirection === "asc" ? "↑" : "↓") : "↕"}
                        </button>
                      </div>
                    </th>
                    <th className="pb-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setShowCostBasisHKD((prev) => !prev)}
                          className="text-gray-300 hover:text-orange-300 transition-colors"
                          title="Toggle Cost Basis between USD and HKD"
                        >
                          Cost Basis ({showCostBasisHKD ? "HKD" : "USD"})
                        </button>
                        <button
                          onClick={() => toggleHoldingsSort("costBasis")}
                          className="text-gray-400 hover:text-orange-300 transition-colors"
                          title="Sort Cost Basis"
                        >
                          {holdingsSortKey === "costBasis" ? (holdingsSortDirection === "asc" ? "↑" : "↓") : "↕"}
                        </button>
                      </div>
                    </th>
                    <th className="pb-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setShowNetPnlHKD((prev) => !prev)}
                          className="text-gray-300 hover:text-orange-300 transition-colors"
                          title="Toggle Net P&L between USD and HKD"
                        >
                          Net P&amp;L ({showNetPnlHKD ? "HKD" : "USD"})
                        </button>
                        <button
                          onClick={() => toggleHoldingsSort("netPnl")}
                          className="text-gray-400 hover:text-orange-300 transition-colors"
                          title="Sort Net P&L"
                        >
                          {holdingsSortKey === "netPnl" ? (holdingsSortDirection === "asc" ? "↑" : "↓") : "↕"}
                        </button>
                      </div>
                    </th>
                    <th className="pb-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {sortedHoldings.map((h) => {
                    const pnlPct = h.currentPrice > 0 && h.avgPrice > 0 ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
                    // Market value = avg cost basis (total shares × average price)
                    const marketValue = h.avgPrice * h.totalShares;
                    const currentValueUSD = h.currentPrice > 0 ? h.currentPrice * h.totalShares : 0;
                    const currentValueDisplay = showCurrentValueHKD && hkdRate > 0 ? currentValueUSD / hkdRate : currentValueUSD;
                    const costBasisDisplay = showCostBasisHKD && hkdRate > 0 ? marketValue / hkdRate : marketValue;
                    const netPnlDisplay = showNetPnlHKD && hkdRate > 0 ? h.pnl / hkdRate : h.pnl;
                    return (
                      <tr key={h.symbol} className="hover:bg-slate-700/30 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <AssetLogo symbol={h.symbol} assetType={h.assetType} size={32} />
                            <div>
                              <div className="font-semibold text-white">{h.symbol}</div>
                              <div className="text-xs text-gray-400 truncate max-w-[120px]">{h.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-300">
                            {ASSET_TYPE_LABELS[h.assetType]}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-200">
                          <FmtNeutral val={h.avgPrice} />
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-200">
                          {h.totalShares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-3 pr-4 text-right">
                          {editingPrice === h.symbol ? (
                            <form
                              className="flex items-center justify-end gap-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const val = parseFloat(editPriceDraft);
                                if (!isNaN(val) && val > 0) {
                                  setPrices((prev) => ({ ...prev, [h.symbol]: val }));
                                  setPricesCurrency((prev) => ({ ...prev, [h.symbol]: "USD" }));
                                }
                                setEditingPrice(null);
                              }}
                            >
                              <input
                                className="input-field w-24 text-right text-sm py-1"
                                type="number"
                                step="0.0001"
                                min="0"
                                autoFocus
                                value={editPriceDraft}
                                onChange={(e) => setEditPriceDraft(e.target.value)}
                                onKeyDown={(e) => e.key === "Escape" && setEditingPrice(null)}
                              />
                              <button type="submit" className="text-green-400 hover:text-green-300 text-xs px-1" title="Save">✓</button>
                              <button type="button" onClick={() => setEditingPrice(null)} className="text-gray-500 hover:text-gray-300 text-xs px-1" title="Cancel">×</button>
                            </form>
                          ) : (
                            <div className="flex items-center justify-end gap-1 group">
                              <span className="text-gray-200">
                                {h.currentPrice > 0 ? <FmtNeutral val={h.currentPrice} /> : <span className="text-gray-500">—</span>}
                              </span>
                              <button
                                onClick={() => { setEditingPrice(h.symbol); setEditPriceDraft(h.currentPrice > 0 ? h.currentPrice.toString() : ""); }}
                                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-orange-400 transition-opacity text-xs"
                                title="Edit price"
                              >
                                ✏️
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-200">
                          {h.currentPrice > 0 ? (
                            <span>
                              {showCurrentValueHKD ? "HK$" : "$"}
                              {currentValueDisplay.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-200">
                          <span>
                            {showCostBasisHKD ? "HK$" : "$"}
                            {costBasisDisplay.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right">
                          {h.currentPrice > 0 ? (
                            <div>
                              <span className={netPnlDisplay < 0 ? "text-red-400" : netPnlDisplay > 0 ? "text-green-400" : "text-gray-300"}>
                                {netPnlDisplay < 0 ? "-" : netPnlDisplay > 0 ? "+" : ""}
                                {showNetPnlHKD ? "HK$" : "$"}
                                {Math.abs(netPnlDisplay).toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              <div className={`text-xs ${pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/portfolio/${h.symbol}`}
                            className="px-3 py-1 rounded-lg bg-orange-600/30 hover:bg-orange-600/60 text-orange-300 text-xs font-medium transition-colors"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Table B – Trades */}
        <section className="bg-slate-800/50 border border-orange-500/20 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-orange-300 mb-4">
            Table B — Trade History
          </h2>
          {trades.length === 0 ? (
            <p className="text-gray-500 text-center py-10">No trades recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-slate-700 text-left">
                    <th className="pb-3 pr-4">
                      <button
                        onClick={() => setTradesDateSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
                        className="inline-flex items-center gap-2 text-gray-300 hover:text-orange-300 transition-colors"
                        title="Sort by Date"
                      >
                        Date {tradesDateSortDirection === "asc" ? "↑" : "↓"}
                      </button>
                    </th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Asset</th>
                    <th className="pb-3 pr-4">Asset Type</th>
                    <th className="pb-3 pr-4 text-right">Price / Share</th>
                    <th className="pb-3 pr-4 text-right">Shares</th>
                    <th className="pb-3 text-right">Total</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {sortedTrades.map((t) => (
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
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <AssetLogo symbol={t.symbol} assetType={t.assetType} size={24} />
                          <div>
                            <div className="font-semibold text-white">{t.symbol}</div>
                            <div className="text-xs text-gray-400 truncate max-w-[100px]">{t.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-300">
                          {ASSET_TYPE_LABELS[t.assetType]}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="text-gray-200">
                          {t.originalCurrency === "HKD" ? (
                            <>
                              <span>HK${(t.originalPrice ?? t.pricePerShare).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                              <div className="text-xs text-gray-500">≈ ${t.pricePerShare.toFixed(4)} USD</div>
                            </>
                          ) : (
                            <FmtNeutral val={t.pricePerShare} decimals={4} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-200">
                        {t.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="py-3 text-right text-gray-200">
                        <FmtNeutral val={t.pricePerShare * t.shares} />
                      </td>
                      <td className="py-3 pl-2">
                        <button
                          onClick={() => deleteTrade(t.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors text-xs"
                          title="Delete trade"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Modals */}
      {modal === "buy" && (
        <TradeModal
          mode="buy"
          onClose={() => setModal(null)}
          onSubmit={addTrade("buy")}
          existingHoldings={holdings}
          hkdRate={hkdRate}
        />
      )}
      {modal === "sell" && (
        <TradeModal
          mode="sell"
          onClose={() => setModal(null)}
          onSubmit={addTrade("sell")}
          existingHoldings={holdings}
          hkdRate={hkdRate}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = "text-white",
  action,
}: {
  label: string;
  value: string;
  color?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-slate-800/50 border border-orange-500/20 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="text-xs text-gray-400">{label}</p>
        {action}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
