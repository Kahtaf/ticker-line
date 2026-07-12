const LSE_SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  "BTC-USD": "BTC/USD",
};

export function toLseSymbol(ticker: string): string {
  return LSE_SYMBOL_ALIASES[ticker] ?? ticker;
}

export function inferLseAssetMetadata(
  providerSymbol: string,
): Readonly<{ assetType: "crypto" | "unknown"; currency?: string }> {
  if (providerSymbol === "BTC/USD") {
    return { assetType: "crypto", currency: "USD" };
  }
  return { assetType: "unknown" };
}
