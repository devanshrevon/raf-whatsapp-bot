const LEAD_STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-accentSoft text-accent",
  BOOKED: "bg-ink text-paper",
  MISSED: "bg-warnSoft text-warn",
  NEEDS_REVIEW: "bg-dangerSoft text-danger",
  COMPLETED: "bg-line text-ink/60",
  STOPPED: "bg-ink/10 text-ink/50"
};

const APPOINTMENT_STATUS_STYLES: Record<string, string> = {
  BOOKED: "bg-accentSoft text-accent",
  MISSED: "bg-warnSoft text-warn",
  COMPLETED: "bg-line text-ink/60",
  CANCELLED: "bg-ink/10 text-ink/50"
};

export function StatusBadge({ status, kind = "lead" }: { status: string; kind?: "lead" | "appointment" }) {
  const styles = kind === "lead" ? LEAD_STATUS_STYLES : APPOINTMENT_STATUS_STYLES;
  const className = styles[status] ?? "bg-line text-ink/60";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
