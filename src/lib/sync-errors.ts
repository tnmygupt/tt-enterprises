/** Shared classifiers so MySQL blips are not shown as “please log in again”. */

const DB_INFRA =
  /database is busy|mysql|econnreset|econnrefused|etimedout|ehostunreach|epipe|protocol_connection|protocol_enqueue|too many connections|er_[a-z0-9_]+|lost connection|server closed the connection|cannot enqueue|connection is in closed state|cloud database not configured|sqlstate/i;

const SESSION_AUTH =
  /log in again|login required|session invalid|account removed|session expired/i;

export function isDatabaseInfraMessage(text: string): boolean {
  return DB_INFRA.test(text || "");
}

export function isSessionAuthMessage(text: string): boolean {
  const value = text || "";
  if (isDatabaseInfraMessage(value)) return false;
  return SESSION_AUTH.test(value);
}

/** 401 with no error body + leftover local session: cookie may still be landing. */
export function shouldRetrySessionCookieCheck(
  status: number,
  error: string | undefined,
  hasLocalSession: boolean
): boolean {
  return status === 401 && !error && hasLocalSession;
}
