import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams
}: {
  searchParams: { next?: string };
}) {
  const user = await getSessionUser();
  if (user) {
    redirect(searchParams.next ?? "/leads");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-2xl font-semibold tracking-tight text-ink">
            Raf — Callback Desk
          </p>
          <p className="mt-1 text-sm text-ink/60">Sign in to view leads and appointments</p>
        </div>
        <LoginForm nextPath={searchParams.next} />
      </div>
    </main>
  );
}
