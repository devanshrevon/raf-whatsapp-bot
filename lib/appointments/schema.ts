import { z } from "zod";

export const appointmentStatusUpdateSchema = z.object({
  status: z.enum(["MISSED", "COMPLETED", "CANCELLED"])
});
