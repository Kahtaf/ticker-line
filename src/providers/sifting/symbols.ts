import type { AssetType } from "../../domain/market-series";

export type SiftingMarket = "stocks" | "forex" | "crypto" | "commodities";

export type SiftingSymbol = Readonly<{
  market: SiftingMarket;
  symbol: string;
  assetType: AssetType;
  currency: string;
}>;

// Sifting's public symbol catalog is finite for non-equity markets. Keeping
// these provider-specific codes at the boundary prevents ambiguous pairs such
// as SOL/USD from being sent to the forex endpoint.
const CRYPTO_SYMBOLS = new Set([
  "AAVEUSD",
  "ADAUSD",
  "ALGOUSD",
  "APEUSD",
  "APTUSD",
  "ARBUSD",
  "ATOMUSD",
  "AVAXUSD",
  "BCHUSD",
  "BNBUSD",
  "BONKUSD",
  "BTCUSD",
  "CRVUSD",
  "DOGEUSD",
  "DOTUSD",
  "ETCUSD",
  "ETHUSD",
  "FILUSD",
  "FLOKIUSD",
  "GRTUSD",
  "HBARUSD",
  "ICPUSD",
  "IMXUSD",
  "INJUSD",
  "JUPUSD",
  "KASUSD",
  "LDOUSD",
  "LINKUSD",
  "LTCUSD",
  "NEARUSD",
  "ONDOUSD",
  "OPUSD",
  "PEPEUSD",
  "POLUSD",
  "PYTHUSD",
  "RENDERUSD",
  "RUNEUSD",
  "SHIBUSD",
  "SOLUSD",
  "STXUSD",
  "SUIUSD",
  "TIAUSD",
  "TONUSD",
  "UNIUSD",
  "VETUSD",
  "WIFUSD",
  "WLDUSD",
  "XLMUSD",
  "XRPUSD",
]);

const COMMODITY_SYMBOLS = new Set([
  "CARBUSD",
  "CATTLEUSD",
  "COALUSD",
  "COCOAUSD",
  "COFFEEUSD",
  "CORNUSD",
  "COTTONUSD",
  "ETHLUSD",
  "FEEDCUSD",
  "GASUSD",
  "HOGSUSD",
  "HOILUSD",
  "IRONUSD",
  "LITHUSD",
  "LMBRUSD",
  "MILKUSD",
  "NATGAS",
  "OATSUSD",
  "OJUICEUSD",
  "PALMUSD",
  "RICEUSD",
  "RUBRUSD",
  "SBOILUSD",
  "SOYBUSD",
  "SUGARUSD",
  "UKOUSD",
  "URANUSD",
  "WHEATUSD",
  "WTIUSD",
  "XAGUSD",
  "XALUSD",
  "XAUUSD",
  "XCUUSD",
  "XNIUSD",
  "XPBUSD",
  "XPDUSD",
  "XPTUSD",
  "XSNUSD",
  "XZNUSD",
]);

const FOREX_SYMBOLS = new Set([
  "AUDCAD",
  "AUDJPY",
  "AUDUSD",
  "CADJPY",
  "CHFJPY",
  "EURAUD",
  "EURCAD",
  "EURCHF",
  "EURGBP",
  "EURJPY",
  "EURUSD",
  "GBPCAD",
  "GBPCHF",
  "GBPJPY",
  "GBPUSD",
  "NZDJPY",
  "NZDUSD",
  "USDCAD",
  "USDCHF",
  "USDJPY",
]);

const ETF_SYMBOLS = new Set(["DIA", "IWM", "QQQ", "SPY"]);
const STOCK_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

function concatenatedPair(ticker: string): string {
  return ticker.replace(/[/-]/g, "");
}

export function toSiftingSymbol(ticker: string): SiftingSymbol | undefined {
  const legacyAlias = ticker === "EURUSD=X" ? "EUR/USD" : ticker;
  const pair = concatenatedPair(legacyAlias);
  if (CRYPTO_SYMBOLS.has(pair)) {
    return {
      market: "crypto",
      symbol: pair,
      assetType: "crypto",
      currency: "USD",
    };
  }
  if (COMMODITY_SYMBOLS.has(pair)) {
    return {
      market: "commodities",
      symbol: pair,
      assetType: "unknown",
      currency: "USD",
    };
  }
  if (FOREX_SYMBOLS.has(pair)) {
    return {
      market: "forex",
      symbol: pair,
      assetType: "forex",
      currency: pair.slice(-3),
    };
  }
  if (!STOCK_SYMBOL.test(ticker)) return undefined;
  return {
    market: "stocks",
    symbol: ticker,
    assetType: ETF_SYMBOLS.has(ticker) ? "etf" : "stock",
    currency: "USD",
  };
}
