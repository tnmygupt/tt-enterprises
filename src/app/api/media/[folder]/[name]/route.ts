import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { MEDIA_FOLDERS, localUploadDir } from "@/lib/server/host-public-file";

const MIME: Record<string, string> = {
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

const SAFE_NAME =
  /^[\w.-]+\.(jpg|jpeg|png|webp|gif|avif|pdf|mp4|webm|mov|ogg)$/i;

/** Serve runtime uploads (packing slips, proofs) over https. */
export async function GET(
  _req: Request,
  context: { params: Promise<{ folder: string; name: string }> },
) {
  const { folder, name } = await context.params;
  if (!MEDIA_FOLDERS.has(folder) || !SAFE_NAME.test(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const filePath = path.join(localUploadDir(folder), name);
  try {
    const buf = await readFile(filePath);
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
