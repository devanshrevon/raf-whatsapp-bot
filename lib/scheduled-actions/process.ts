// Phase 5: the actual cron processing loop called from
// app/api/internal/process-scheduled-actions/route.ts (spec section 17).
// TODO: claim PENDING actions, check opt-out/pause/appointment state, send
// the permitted message, mark COMPLETED, retry/FAIL per the spec's rules.
