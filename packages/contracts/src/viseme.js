import { z } from 'zod';
export const VisemeEventSchema = z.object({
    visemeId: z.number().int().nonnegative(),
    audioOffsetMs: z.number().int().nonnegative(),
});
