"use client";

import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "./config";

let anonReady: Promise<boolean> | null = null;

/** Sign in anonymously so Storage/Firestore writes work when rules require auth. */
export function ensureAnonymousAuth(): Promise<boolean> {
  if (!isFirebaseConfigured()) return Promise.resolve(false);
  if (anonReady) return anonReady;

  anonReady = (async () => {
    const auth = getFirebaseAuth();
    if (!auth) return false;
    if (auth.currentUser) return true;
    await new Promise<void>((resolve) => {
      const unsub = onAuthStateChanged(auth, () => {
        unsub();
        resolve();
      });
    });
    if (auth.currentUser) return true;
    await signInAnonymously(auth);
    return true;
  })().catch((err) => {
    console.warn("[firebase] anonymous auth failed", err);
    anonReady = null;
    return false;
  });

  return anonReady;
}
