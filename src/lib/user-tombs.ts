/**
 * Timestamped user-delete tombstones.
 * Stale browsers that still have a deleted login cannot clear a newer tomb
 * just by pushing the old user row again.
 */

export type TombMap = Record<string, string>;

const LEGACY_TOMB_AT = "1970-01-01T00:00:00.000Z";

export function tombsFromDb(db: {
  deletedUserIds?: string[];
  deletedUserAt?: TombMap;
}): TombMap {
  const out: TombMap = { ...(db.deletedUserAt ?? {}) };
  for (const id of db.deletedUserIds ?? []) {
    if (!out[id]) out[id] = LEGACY_TOMB_AT;
  }
  return out;
}

export function mergeTombMaps(...maps: TombMap[]): TombMap {
  const out: TombMap = {};
  for (const m of maps) {
    for (const [id, at] of Object.entries(m ?? {})) {
      if (!at) continue;
      if (!out[id] || at > out[id]) out[id] = at;
    }
  }
  return out;
}

export function userBeatsTomb(
  user: { id: string; createdAt?: string },
  tombs: TombMap
): boolean {
  const at = tombs[user.id];
  if (!at) return true;
  const created = (user.createdAt || "").trim();
  return !!created && created > at;
}

export function applyTombsToUsers<T extends { id: string; createdAt?: string }>(
  users: T[],
  tombs: TombMap
): T[] {
  return users.filter((u) => userBeatsTomb(u, tombs));
}

/** Drop tombstones beaten by a newer user.createdAt (intentional re-create). */
export function clearTombsBeatenByUsers(
  tombs: TombMap,
  users: { id: string; createdAt?: string }[]
): TombMap {
  const out = { ...tombs };
  for (const u of users) {
    const at = out[u.id];
    if (!at) continue;
    const created = (u.createdAt || "").trim();
    if (created && created > at) delete out[u.id];
  }
  return out;
}

export function syncTombFields(tombs: TombMap): {
  deletedUserIds: string[];
  deletedUserAt: TombMap;
} {
  return {
    deletedUserIds: Object.keys(tombs),
    deletedUserAt: tombs,
  };
}
