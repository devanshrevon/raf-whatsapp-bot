import { z } from "zod";

export const leadActionSchema = z.object({
  action: z.enum(["pause", "resume", "markCompleted", "markMissed", "stop"])
});

export type LeadAction = z.infer<typeof leadActionSchema>["action"];
