import type { AssetType, Market } from "../../domain/market-series";

function quoteCurrency(ticker: string): string | undefined {
  const parts = ticker.split("/");
  const quote = parts.length === 2 ? parts[1] : undefined;
  return quote?.length === 3 ? quote : undefined;
}

/** LSE accepts ticker-line's documented slash and security symbol forms. */
export function toLseSymbol(ticker: string): string {
  return ticker;
}

export function inferLseAssetMetadata(
  ticker: string,
  market: Market,
): Readonly<{ assetType: AssetType; currency?: string }> {
  const currency = market === "stock" ? undefined : quoteCurrency(ticker);
  return {
    assetType: market,
    ...(currency === undefined ? {} : { currency }),
  };
}
