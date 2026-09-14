import type { UserProfile } from "@/lib/types";
import { hashPasswordSecure } from "@/lib/server/session";

export const MIN_PASSWORD_LEN = 6;
export const FORGOT_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

export function readNewPassword(raw: unknown): string | null {
  const pw = String(raw ?? "").trim();
  if (pw.length < MIN_PASSWORD_LEN) return null;
  return pw;
}

/** User changed it themselves — never keep plaintext for admin. */
export function applyOwnPassword(user: UserProfile, password: string): void {
  user.passwordHash = hashPasswordSecure(password);
  delete user.passwordVisible;
  delete user.passwordResetRequestedAt;
}

/** Admin set a new password to share back. */
export function applyAdminResetPassword(
  user: UserProfile,
  password: string
): void {
  user.passwordHash = hashPasswordSecure(password);
  user.passwordVisible = password;
  delete user.passwordResetRequestedAt;
}

export function shouldNotifyForgotAgain(
  requestedAt: string | undefined,
  nowMs = Date.now()
): boolean {
  if (!requestedAt) return true;
  const at = Date.parse(requestedAt);
  if (!Number.isFinite(at)) return true;
  return nowMs - at >= FORGOT_NOTIFY_COOLDOWN_MS;
}
