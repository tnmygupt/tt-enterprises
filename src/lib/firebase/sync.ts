"use client";

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import type { AppDatabase } from "@/lib/store/db";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { ensureAnonymousAuth } from "./anon";
import { getFirestoreDb, isFirebaseConfigured } from "./config";

const DOC_PATH = { collection: "tt", id: "appDatabase" } as const;

type CloudPayload = {
  updatedAt: string;
  db: AppDatabase;
};

function stripHeavyDataUrls(db: AppDatabase): AppDatabase {
  return sanitizeDbForCloud(db);
}

export function firebaseSyncEnabled(): boolean {
  return isFirebaseConfigured();
}

export async function pullCloudDatabase(): Promise<AppDatabase | null> {
  if (!isFirebaseConfigured()) return null;
  await ensureAnonymousAuth();
  const firestore = getFirestoreDb();
  if (!firestore) return null;
  const ref = doc(firestore, DOC_PATH.collection, DOC_PATH.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as CloudPayload;
  return data?.db ?? null;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushJson = "";

export function schedulePushCloudDatabase(db: AppDatabase): void {
  if (!isFirebaseConfigured()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushCloudDatabase(db);
  }, 600);
}

export async function pushCloudDatabase(db: AppDatabase): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    await ensureAnonymousAuth();
    const firestore = getFirestoreDb();
    if (!firestore) return false;
    const payload: CloudPayload = {
      updatedAt: new Date().toISOString(),
      db: stripHeavyDataUrls(db),
    };
    const json = JSON.stringify(payload.db);
    if (json === lastPushJson) return true;
    const ref = doc(firestore, DOC_PATH.collection, DOC_PATH.id);
    await setDoc(ref, payload, { merge: false });
    lastPushJson = json;
    return true;
  } catch (err) {
    console.warn("[firebase] push failed", err);
    return false;
  }
}

export async function ensureCloudSeed(localDb: AppDatabase): Promise<AppDatabase> {
  if (!isFirebaseConfigured()) return localDb;
  const remote = await pullCloudDatabase();
  if (remote) return remote;
  await pushCloudDatabase(localDb);
  return localDb;
}

/** Live shared DB — all browsers stay in sync when Firebase is configured. */
export function subscribeCloudDatabase(
  onChange: (db: AppDatabase) => void
): Unsubscribe | null {
  if (!isFirebaseConfigured()) return null;
  const firestore = getFirestoreDb();
  if (!firestore) return null;
  const ref = doc(firestore, DOC_PATH.collection, DOC_PATH.id);

  void ensureAnonymousAuth();

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as CloudPayload;
      if (data?.db) {
        lastPushJson = JSON.stringify(stripHeavyDataUrls(data.db));
        onChange(data.db);
      }
    },
    (err) => console.warn("[firebase] subscribe failed", err)
  );
}
