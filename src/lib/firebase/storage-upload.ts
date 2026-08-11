"use client";

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { ensureAnonymousAuth } from "./anon";
import { getFirebaseStorage, isFirebaseConfigured } from "./config";

export async function uploadToFirebaseStorage(
  file: File,
  folder: string
): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    await ensureAnonymousAuth();
    const storage = getFirebaseStorage();
    if (!storage) return null;
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path = `uploads/${folder}/${Date.now()}_${safe}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    });
    return await getDownloadURL(storageRef);
  } catch (err) {
    console.warn("[firebase] storage upload failed", err);
    return null;
  }
}
