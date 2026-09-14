import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { readSessionCookie } from "@/lib/server/session";
import { hostPublicBuffer, MEDIA_BUCKET } from "@/lib/server/host-public-file";

const MAX_BYTES = 80 * 1024 * 1024; // 80 MB
const ALLOWED =
  /^(image\/(jpeg|jpg|png|webp|gif|avif)|video\/(mp4|webm|quicktime|ogg)|application\/pdf)$/i;

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogg: "video/ogg",
};

const FOLDERS = new Set(["products", "bills", "lr", "proofs", "misc", "hr"]);

function resolveMime(file: File): string {
  const typed = (file.type || "").trim().toLowerCase();
  if (typed && typed !== "application/octet-stream" && ALLOWED.test(typed)) {
    return typed;
  }
  const ext = path
    .extname(file.name || "")
    .toLowerCase()
    .replace(".", "");
  return EXT_MIME[ext] || typed || "";
}

function authorizeUpload(req: NextRequest): {
  ok: boolean;
  session: ReturnType<typeof readSessionCookie>;
} {
  const session = readSessionCookie(req);
  if (!session) return { ok: false, session: null };

  // Staff session is enough. Hostinger builds often lack NEXT_PUBLIC_UPLOAD_KEY,
  // which used to 401 PDF uploads so packing-slip WhatsApp had no file to attach.
  if (session.role !== "customer") return { ok: true, session };

  const required = (process.env.UPLOAD_KEY || "").trim();
  if (!required) {
    return { ok: true, session };
  }
  const key = req.headers.get("x-upload-key") || "";
  const dbKey = (
    process.env.NEXT_PUBLIC_DB_API_KEY ||
    process.env.DB_API_KEY ||
    ""
  ).trim();
  const ok = key === required || (Boolean(dbKey) && key === dbKey);
  return { ok, session };
}

export async function POST(req: NextRequest) {
  const auth = authorizeUpload(req);
  if (!auth.ok || !auth.session) {
    return NextResponse.json(
      { error: "Login required to upload" },
      { status: 401 },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const mime = resolveMime(file);
    if (!ALLOWED.test(mime)) {
      return NextResponse.json(
        {
          error:
            "Only JPG, PNG, WebP, GIF, PDF, or video files are allowed. On iPhone use JPG/PNG (not HEIC).",
        },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File must be under 80 MB" },
        { status: 400 },
      );
    }

    const folderRaw = String(form.get("folder") || "products");
    let folder = FOLDERS.has(folderRaw) ? folderRaw : "misc";
    // Dealers may only upload payment proofs
    if (auth.session.role === "customer") {
      if (folder !== "proofs") {
        return NextResponse.json(
          { error: "Dealers may only upload payment proofs" },
          { status: 403 },
        );
      }
      folder = "proofs";
    }

    const hosted = await hostPublicBuffer({
      buffer: Buffer.from(await file.arrayBuffer()),
      mime,
      folder,
      originalName: file.name,
    });
    if (!hosted) {
      return NextResponse.json({ error: "Upload failed" }, { status: 502 });
    }

    return NextResponse.json({
      url: hosted.url,
      type: hosted.kind,
      name: hosted.name,
      size: hosted.size,
      folder,
      storage: hosted.storage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "tt-enterprises-upload",
    maxBytes: MAX_BYTES,
    folders: [...FOLDERS],
    authRequired: true,
    sessionRequired: true,
    supabaseStorage: false,
    serviceRole: false,
    bucket: MEDIA_BUCKET,
  });
}
