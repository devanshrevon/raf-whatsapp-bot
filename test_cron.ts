import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "@/lib/db";
import { processDueScheduledActions } from "@/lib/scheduled-actions/process";

async function run() {
  const pending = await db.scheduledAction.findMany({ where: { status: "PENDING" } });
  console.log("Pending actions:", pending.length);
  if (pending.length > 0) {
      await db.scheduledAction.updateMany({
          data: { scheduledAt: new Date(Date.now() - 86400000) } // force 1 day past
      });
  }

  // we can also just call `processAction` directly to bypass the findMany if we want, but it's not exported.
  // We'll run processDueScheduledActions. To avoid twilio error, let's observe what happens.
  const res = await processDueScheduledActions();
  console.log("Process result:", res);

  const after = await db.scheduledAction.findMany({ where: { id: { in: pending.map(p => p.id) } } });
  console.log("After process status:", after.map(a => a.status));
}

run();
