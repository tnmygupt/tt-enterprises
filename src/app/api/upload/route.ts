import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readSessionCookie } from "@/lib/server/session";
import {
  getSupabaseKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

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

const FOLDERS = new Set(["products", "bills", "lr", "proofs", "misc"]);

const SUPABASE_BUCKET = "product-media";

function resolveMime(file: File): string {
  const typed = (file.type || "").trim().toLowerCase();
  if (typed && typed !== "application/octet-stream" && ALLOWED.test(typed)) {
    return typed;
  }
  const ext = path.extname(file.name || "").toLowerCase().replace(".", "");
  return EXT_MIME[ext] || typed || "";
}

function extFromFile(file: File, mime?: string): string {
  const map: Record<string, string> = {
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
  // Never trust client filename extension (blocks xss.html / shell.php)
  return map[mime || file.type] || "bin";
}

function authorizeUpload(req: NextRequest): {
  ok: boolean;
  session: ReturnType<typeof readSessionCookie>;
} {
  const session = readSessionCookie(req);
  if (!session) return { ok: false, session: null };

  const required = (process.env.UPLOAD_KEY || "").trim();
  if (!required) {
    return {
      ok: process.env.NODE_ENV !== "production",
      session,
    };
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

async function uploadToSupabase(
  file: File,
  folder: string,
  mime: string
): Promise<{ url: string; type: string; name: string; size: number } | null> {
  if (!isSupabaseConfigured()) return null;
  // Prefer service role so Storage RLS can deny anon writes
  const key = getSupabaseServiceKey() || getSupabaseKey();
  const supabase = createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const kind = mime.startsWith("video/")
    ? "video"
    : mime === "application/pdf"
      ? "pdf"
      : "image";
  const ext = extFromFile(file, mime);
  const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
  const objectPath = `${folder}/${name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });
  if (error) {
    console.warn("[upload] supabase storage failed", error.message);
    return null;
  }

  const { data } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(objectPath);
  if (!data?.publicUrl) return null;

  return {
    url: data.publicUrl,
    type: kind,
    name: file.name,
    size: file.size,
  };
}

export async function POST(req: NextRequest) {
  const auth = authorizeUpload(req);
  if (!auth.ok || !auth.session) {
    return NextResponse.json(
      { error: "Login required to upload" },
      { status: 401 }
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
        { status: 400 }
      );
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File must be under 80 MB" },
        { status: 400 }
      );
    }

    const folderRaw = String(form.get("folder") || "products");
    let folder = FOLDERS.has(folderRaw) ? folderRaw : "misc";
    // Dealers may only upload payment proofs
    if (auth.session.role === "customer") {
      if (folder !== "proofs") {
        return NextResponse.json(
          { error: "Dealers may only upload payment proofs" },
          { status: 403 }
        );
      }
      folder = "proofs";
    }

    const cloud = await uploadToSupabase(file, folder, mime);
    if (cloud) {
      return NextResponse.json({
        ...cloud,
        folder,
        storage: "supabase",
      });
    }

    // Local disk fallback when Storage rejects anon / service role missing
    if (process.env.NODE_ENV === "production" && !getSupabaseServiceKey()) {
      // Still allow local so proofs don't hard-fail on Hostinger without service role
    }

    const kind = mime.startsWith("video/")
      ? "video"
      : mime === "application/pdf"
        ? "pdf"
        : "image";
    const ext = extFromFile(file, mime);
    const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(dir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, name), buffer);

    return NextResponse.json({
      url: `/uploads/${folder}/${name}`,
      type: kind,
      name: file.name,
      size: file.size,
      folder,
      storage: "local",
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
    supabaseStorage: isSupabaseConfigured(),
    serviceRole: Boolean(getSupabaseServiceKey()),
    bucket: SUPABASE_BUCKET,
  });
}
