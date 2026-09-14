import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const MEDIA_BUCKET = "product-media";
export const MEDIA_FOLDERS = new Set([
  "products",
  "bills",
  "lr",
  "proofs",
  "misc",
  "hr",
]);

const EXT_FROM_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogg",
  "application/pdf": "pdf",
};

export function mediaKind(mime: string): "image" | "video" | "pdf" {
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "image";
}

export function localUploadDir(folder: string): string {
  return path.join(process.cwd(), "data", "uploads", folder);
}

function safeExt(mime: string): string {
  return EXT_FROM_MIME[mime] || "bin";
}

/** Host a file on a public HTTPS URL dealers can fetch. */
export async function hostPublicBuffer(input: {
  buffer: Buffer;
  mime: string;
  folder: string;
  originalName?: string;
}): Promise<{
  url: string;
  storage: "local";
  kind: "image" | "video" | "pdf";
  name: string;
  size: number;
} | null> {
  const folder = MEDIA_FOLDERS.has(input.folder) ? input.folder : "misc";
  const ext = safeExt(input.mime);
  const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
  const kind = mediaKind(input.mime);

  try {
    const dir = localUploadDir(folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), input.buffer);
    return {
      url: `/api/media/${folder}/${name}`,
      storage: "local",
      kind,
      name: input.originalName || name,
      size: input.buffer.length,
    };
  } catch (err) {
    console.warn(
      "[upload] local write failed",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
