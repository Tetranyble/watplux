import { z } from "zod";

export const updateSiteCopySchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(191),
        value: z.string().max(20_000),
      }),
    )
    .min(1)
    .max(250),
});

export type UpdateSiteCopyInput = z.infer<typeof updateSiteCopySchema>;
