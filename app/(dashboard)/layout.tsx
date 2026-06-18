import { getSessionUser } from "@/lib/auth/session";
import { NavLink } from "./nav-link";
import { logout } from "./actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-56 flex-col justify-between border-r border-line px-4 py-6">
        <div>
          <p className="font-display px-3 text-lg font-semibold tracking-tight text-ink">Raf</p>
          <p className="mb-6 px-3 text-xs text-ink/50">Callback desk</p>
          <nav className="space-y-1">
            <NavLink href="/leads" label="Leads" />
            <NavLink href="/appointments" label="Appointments" />
          </nav>
        </div>
        <div className="px-3">
          <p className="mb-2 truncate text-xs text-ink/50">{user}</p>
          <form action={logout}>
            <button
              type="submit"
              className="focus-ring text-xs font-medium text-ink/60 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
