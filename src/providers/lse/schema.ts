import { z } from "zod";

const providerNumericValue = z.union([z.number(), z.string()]);

export const lseCandleSchema = z
  .object({
    ts: z.string(),
    symbol: z.string().min(1),
    open: providerNumericValue,
    high: providerNumericValue,
    low: providerNumericValue,
    close: providerNumericValue,
    volume: providerNumericValue.optional(),
  })
  .passthrough();

export const lseCandlesSchema = z.array(lseCandleSchema).max(5_000);

export type LseCandle = z.infer<typeof lseCandleSchema>;
