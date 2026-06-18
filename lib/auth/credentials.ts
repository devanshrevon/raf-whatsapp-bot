import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  if (username !== env.adminUsername) return false;
  return bcrypt.compare(password, env.adminPasswordHash);
}
