import { mkdir } from "fs/promises";
import path from "path";

/** Server-side writable data folder (Tally sync, etc.) */
export function dataDir(): string {
  return path.join(process.cwd(), "data");
}

export async function ensureDataDir(): Promise<string> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  return dir;
}
