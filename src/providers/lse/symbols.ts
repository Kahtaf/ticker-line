import type { AssetType } from "../../domain/market-series";

type LseSymbolAlias = Readonly<{
  symbol: string;
  assetType: AssetType;
  currency?: string;
}>;

const LSE_SYMBOL_ALIASES: Readonly<Record<string, LseSymbolAlias>> = {
  "BTC-USD": { symbol: "BTC/USD", assetType: "crypto", currency: "USD" },
  "ETH-USD": { symbol: "ETH/USD", assetType: "crypto", currency: "USD" },
  "SOL-USD": { symbol: "SOL/USD", assetType: "crypto", currency: "USD" },
  "NAS100/USD": {
    symbol: "NAS100/USD",
    assetType: "index",
    currency: "USD",
  },
  "XAU/USD": { symbol: "XAU/USD", assetType: "unknown", currency: "USD" },
  "USD/CAD": { symbol: "USD/CAD", assetType: "forex", currency: "CAD" },
  "EURUSD=X": { symbol: "EUR/USD", assetType: "forex", currency: "USD" },
  "^GSPC": { symbol: "SPX500/USD", assetType: "index", currency: "USD" },
  "^DJI": { symbol: "US30/USD", assetType: "index", currency: "USD" },
  "^IXIC": { symbol: "NASCOMP/USD", assetType: "index", currency: "USD" },
  "^RUT": { symbol: "US2000/USD", assetType: "index", currency: "USD" },
};

export function toLseSymbol(ticker: string): string {
  return LSE_SYMBOL_ALIASES[ticker]?.symbol ?? ticker;
}

export function inferLseAssetMetadata(
  providerSymbol: string,
): Readonly<{ assetType: AssetType; currency?: string }> {
  const alias = Object.values(LSE_SYMBOL_ALIASES).find(
    ({ symbol }) => symbol === providerSymbol,
  );
  if (alias !== undefined)
    return alias.currency === undefined
      ? { assetType: alias.assetType }
      : { assetType: alias.assetType, currency: alias.currency };
  return { assetType: "unknown" };
}
