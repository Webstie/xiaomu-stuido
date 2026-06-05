import { z } from 'zod';

export const EXPRESSION_IDS = [
  'happy', 'excited', 'calm', 'gentle', 'listening', 'curious',
  'thinking', 'sad', 'anxious', 'sleepy', 'surprised', 'celebrating',
  'proud', 'confused', 'playful', 'encouraging',
] as const;

export type ExpressionId = typeof EXPRESSION_IDS[number];

export const ExpressionIdSchema = z.enum(EXPRESSION_IDS);

export const ExpressionTimelineEventSchema = z.object({
  expressionId: ExpressionIdSchema,
  audioOffsetMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
});

export type ExpressionTimelineEvent = z.infer<typeof ExpressionTimelineEventSchema>;

export const ExpressionTimelineSchema = z.array(ExpressionTimelineEventSchema);
export type ExpressionTimeline = z.infer<typeof ExpressionTimelineSchema>;
