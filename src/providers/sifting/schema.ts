import { z } from "zod";

export const siftingBarSchema = z.looseObject({
  t: z.number().int().nonnegative(),
  c: z.number(),
});

export const siftingBarsSchema = z.looseObject({
  data: z.array(siftingBarSchema).max(5_000),
  meta: z.looseObject({
    symbol: z.string().min(1),
    interval: z.string().min(1),
    as_of: z.string().min(1),
    next_cursor: z.string().min(1).optional(),
  }),
});

export type SiftingBars = z.infer<typeof siftingBarsSchema>;
