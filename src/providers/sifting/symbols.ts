import type { AssetType, Market } from "../../domain/market-series";

export type SiftingMarket = "stocks" | "forex" | "crypto" | "commodities";

export type SiftingSymbol = Readonly<{
  market: SiftingMarket;
  symbol: string;
  assetType: AssetType;
  currency?: string;
}>;

const SIFTING_MARKETS: Readonly<Partial<Record<Market, SiftingMarket>>> = {
  stock: "stocks",
  crypto: "crypto",
  forex: "forex",
  commodity: "commodities",
};

function concatenatedSymbol(ticker: string): string {
  return ticker.replace(/[/-]/g, "");
}

function quoteCurrency(ticker: string): string | undefined {
  const slashPair = ticker.split("/");
  const slashQuote = slashPair.length === 2 ? slashPair[1] : undefined;
  if (slashQuote?.length === 3) return slashQuote;

  const concatenated = concatenatedSymbol(ticker);
  return concatenated.length === 6 ? concatenated.slice(-3) : undefined;
}

/** Convert a typed public symbol to Sifting's documented market endpoint form. */
export function toSiftingSymbol(
  ticker: string,
  market: Market,
): SiftingSymbol | undefined {
  const providerMarket = SIFTING_MARKETS[market];
  if (providerMarket === undefined) return undefined;

  const currency = market === "stock" ? "USD" : quoteCurrency(ticker);
  return {
    market: providerMarket,
    symbol: market === "stock" ? ticker : concatenatedSymbol(ticker),
    assetType: market,
    ...(currency === undefined ? {} : { currency }),
  };
}
