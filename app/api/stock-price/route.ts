import { NextRequest } from "next/server";

const AV_KEY = "GZXM3WH5QC0GXHO2";

/** Infer the native currency from the symbol (e.g. 0700.HK → HKD) */
function inferCurrency(symbol: string): string {
  const u = symbol.toUpperCase();
  if (u.endsWith(".HK") || u.endsWith(".HKG")) return "HKD";
  return "USD";
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");

  if (!symbol || !/^[A-Za-z0-9.\-^=]+$/.test(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  // ── HKD/USD exchange rate — use fixed HK peg approximation ─────────────
  if (symbol.toUpperCase() === "HKDUSD=X") {
    return Response.json({ symbol: "HKDUSD=X", price: 1 / 7.80, previousClose: 1 / 7.80, longName: "HKD/USD", currency: "USD" });
  }

  // ── Stock / crypto / option quote ────────────────────────────────────────
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`;
    const res = await fetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      return Response.json({ error: `Alpha Vantage returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const quote = data?.["Global Quote"];

    // Alpha Vantage returns an empty object when the symbol is unknown
    if (!quote || !quote["05. price"]) {
      return Response.json({ error: `No data found for symbol ${symbol}` }, { status: 404 });
    }

    const price = parseFloat(quote["05. price"]);
    const previousClose = parseFloat(quote["08. previous close"] ?? "0");
    const currency = inferCurrency(symbol);

    return Response.json({
      symbol: symbol.toUpperCase(),
      price,
      previousClose,
      longName: symbol.toUpperCase(),
      currency,
    });
  } catch {
    return Response.json({ error: "Failed to fetch price" }, { status: 500 });
  }
}
