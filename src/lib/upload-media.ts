import { fileToDataUrl } from "@/lib/hooks";

export type UploadedMedia = {
  url: string;
  type: "image" | "video" | "pdf";
  storage?: "firebase" | "local" | "data" | "supabase";
};

const DATA_URL_MAX = 1.5 * 1024 * 1024;
/** Compress phone gallery photos above this size before upload. */
const COMPRESS_ABOVE = 2.5 * 1024 * 1024;
const COMPRESS_MAX_EDGE = 1920;
const COMPRESS_QUALITY = 0.82;

export type UploadFolder = "products" | "bills" | "lr" | "proofs" | "misc" | "hr";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  qt: "video/quicktime",
};

/** Many Android gallery picks report empty MIME — sniff from the file name. */
export function sniffFileMime(file: File): string {
  const typed = (file.type || "").trim().toLowerCase();
  if (typed && typed !== "application/octet-stream") return typed;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return EXT_MIME[ext] || "";
}

export function normalizeUploadFile(file: File): File {
  const mime = sniffFileMime(file);
  if (!mime || mime === file.type) return file;
  return new File([file], file.name || `upload.${mime.split("/")[1] || "bin"}`, {
    type: mime,
    lastModified: file.lastModified,
  });
}

function classifyMime(mime: string): "image" | "video" | "pdf" | null {
  if (!mime) return null;
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return null;
}

/** Shrink large phone photos so uploads succeed on mobile networks. */
async function maybeCompressImage(file: File): Promise<File> {
  const mime = sniffFileMime(file);
  if (!mime.startsWith("image/")) return file;
  if (mime === "image/gif" || mime === "image/heic" || mime === "image/heif") {
    return file;
  }
  if (file.size <= COMPRESS_ABOVE) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      COMPRESS_MAX_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "proof";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/**
 * Upload file for live ops:
 * 1) Firebase Storage when configured
 * 2) Server /api/upload (Supabase Storage or local public/uploads)
 * 3) Small image data-URL fallback (dev / offline only)
 */
export async function uploadMediaFile(
  file: File,
  folder: UploadFolder = "products"
): Promise<UploadedMedia> {
  let ready = normalizeUploadFile(file);
  const mime = sniffFileMime(ready);
  const kind = classifyMime(mime);

  if (!kind) {
    throw new Error(
      "Only image, video, or PDF files are allowed. On iPhone, choose JPG/PNG or PDF (not HEIC)."
    );
  }
  if (mime === "image/heic" || mime === "image/heif") {
    throw new Error(
      "HEIC photos are not supported. Please export/share as JPG or PNG, or pick a screenshot."
    );
  }

  if (kind === "image") {
    ready = await maybeCompressImage(ready);
  }

  // Prefer Firebase Storage for shared beta (works across devices)
  try {
    const { uploadToFirebaseStorage } = await import(
      "@/lib/firebase/storage-upload"
    );
    const { isFirebaseConfigured } = await import("@/lib/firebase/config");
    if (isFirebaseConfigured()) {
      const url = await uploadToFirebaseStorage(ready, folder);
      if (url) {
        return {
          url,
          type: kind,
          storage: "firebase",
        };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const body = new FormData();
    body.append("file", ready);
    body.append("folder", folder);
    const headers: Record<string, string> = {};
    const uploadKey =
      (process.env.NEXT_PUBLIC_UPLOAD_KEY || "").trim() ||
      (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
    if (uploadKey) headers["x-upload-key"] = uploadKey;
    const res = await fetch("/api/upload", {
      method: "POST",
      body,
      credentials: "include",
      headers,
    });
    const data = (await res.json()) as {
      url?: string;
      type?: "image" | "video" | "pdf";
      storage?: "firebase" | "local" | "supabase";
      error?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(data.error || "Upload failed");
    }
    if (data.url.startsWith("data:")) {
      throw new Error("Server returned a non-shareable image URL");
    }
    return {
      url: data.url,
      type: data.type ?? kind,
      storage: data.storage ?? "local",
    };
  } catch (err) {
    // Never persist unrehosted data-URLs when cloud sync is on — they are
    // stripped and vanish on other devices. Fail closed in production too
    // (Hostinger often has only server-side SUPABASE_URL, not NEXT_PUBLIC_*).
    const syncOn =
      process.env.NODE_ENV === "production" ||
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
          process.env.NEXT_PUBLIC_FIREBASE_API_KEY
      );
    if (syncOn) {
      throw err instanceof Error
        ? err
        : new Error("Could not upload file to server");
    }
    if (kind === "image" && ready.size <= DATA_URL_MAX) {
      const url = await fileToDataUrl(ready);
      console.warn(
        "[upload] using data-URL fallback — image will not appear on other phones"
      );
      return { url, type: "image", storage: "data" };
    }
    throw err instanceof Error
      ? err
      : new Error("Could not upload file to server");
  }
}

/** @deprecated use uploadMediaFile — kept for existing product admin imports */
export async function uploadProductMedia(file: File): Promise<UploadedMedia> {
  return uploadMediaFile(file, "products");
}
