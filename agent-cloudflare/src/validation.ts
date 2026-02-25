import { z } from "zod";

export const resolveRequestSchema = z.object({
  market_id: z.number().int().min(0),
  question: z.string().min(1),
  deadline: z.number().optional(),
  context: z.string().optional(),
});

export const challengeRequestSchema = z.object({
  challenges: z.array(z.string().min(1)).min(1),
});

export type ValidResolveRequest = z.infer<typeof resolveRequestSchema>;
export type ValidChallengeRequest = z.infer<typeof challengeRequestSchema>;
