"use server";

import { redirect } from "next/navigation";
import { verifyCredentials } from "@/lib/auth/credentials";
import { createSessionCookie } from "@/lib/auth/session";

export type LoginState = { error: string | null };

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/leads");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const ok = await verifyCredentials(username, password);
  if (!ok) {
    return { error: "Incorrect username or password." };
  }

  await createSessionCookie(username);
  redirect(next || "/leads");
}
