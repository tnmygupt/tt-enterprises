import type { TallyRegistryLedgerInput, TallyRegistryItemInput } from "@/lib/tally-sync";

const HEADER =
  /^(name|particulars|ledger name|stock item name|item name|item)$/i;

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text?: unknown }).text || "").trim();
  }
  return String(value).trim();
}

/** Pull master names out of a Tally "List of Accounts" export (csv or sheet rows). */
export function namesFromRows(rows: unknown[][]): string[] {
  const grid = rows.map((row) => (row ?? []).map(cellText));
  let header = -1;
  let col = 0;
  const scan = Math.min(grid.length, 25);
  for (let r = 0; r < scan; r += 1) {
    const found = grid[r].findIndex((c) => HEADER.test(c));
    if (found >= 0) {
      header = r;
      col = found;
      break;
    }
  }
  const start = header >= 0 ? header + 1 : 0;
  const names: string[] = [];
  const seen = new Set<string>();
  for (let r = start; r < grid.length; r += 1) {
    const cells = grid[r].filter(Boolean);
    if (!cells.length) continue;
    const name = (header >= 0 ? grid[r][col] : cells[0]) || "";
    if (!name || HEADER.test(name)) continue;
    if (/^(list of|total|grand total)$/i.test(name)) continue;
    if (/^[\d.,]+$/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function namesFromCsv(text: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "," || ch === "\t") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return namesFromRows(rows);
}

export async function namesFromXlsx(data: ArrayBuffer | Buffer): Promise<string[]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    rows.push(values.slice(1));
  });
  return namesFromRows(rows);
}

export function registryFromNames(
  kind: "items" | "ledgers",
  names: string[]
): { items?: TallyRegistryItemInput[]; ledgers?: TallyRegistryLedgerInput[] } {
  if (kind === "ledgers") {
    return { ledgers: names.map((name) => ({ name })) };
  }
  return { items: names.map((name) => ({ name })) };
}
