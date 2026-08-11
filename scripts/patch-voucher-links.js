const fs = require("fs");
const path = require("path");

const root =
  "D:/TT ENTERPRISES NEW WEBSITE/TT ENTERPRISES NEW WEBSITE/src/app/[locale]/admin/accounts";
const importLine =
  'import { VoucherNumberLink } from "@/components/VoucherNumberLink";';

const patches = [
  {
    file: "party-statement/page.tsx",
    replaces: [
      [
        "{e.voucherNumber} · {e.voucherType}",
        '<VoucherNumberLink id={e.voucherId} number={e.voucherNumber} />{" "}· {e.voucherType}',
      ],
      [
        "{r.voucher.number}",
        "<VoucherNumberLink id={r.voucher.id} number={r.voucher.number} />",
      ],
    ],
  },
  {
    file: "ledger/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{e.voucherNumber}</td>',
        '<td><VoucherNumberLink id={e.voucherId} number={e.voucherNumber} /></td>',
      ],
    ],
  },
  {
    file: "daybook/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{v.number}</td>',
        '<td><VoucherNumberLink id={v.id} number={v.number} /></td>',
      ],
    ],
  },
  {
    file: "cash-bank/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{e.voucherNumber}</td>',
        '<td><VoucherNumberLink id={e.voucherId} number={e.voucherNumber} /></td>',
      ],
    ],
  },
  {
    file: "receivables/page.tsx",
    replaces: [
      [
        "{row.voucher.number}",
        "<VoucherNumberLink id={row.voucher.id} number={row.voucher.number} />",
      ],
    ],
  },
  {
    file: "payables/page.tsx",
    replaces: [
      [
        "{row.voucher.number}",
        "<VoucherNumberLink id={row.voucher.id} number={row.voucher.number} />",
      ],
    ],
  },
  {
    file: "journal/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{v.number}</td>',
        '<td><VoucherNumberLink id={v.id} number={v.number} /></td>',
      ],
    ],
  },
  {
    file: "expenses/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{v.number}</td>',
        '<td><VoucherNumberLink id={v.id} number={v.number} /></td>',
      ],
    ],
  },
  {
    file: "purchases/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{v.number}</td>',
        '<td><VoucherNumberLink id={v.id} number={v.number} /></td>',
      ],
    ],
  },
  {
    file: "openings/page.tsx",
    replaces: [
      [
        '<td className="font-mono text-sm">{v.number}</td>',
        '<td><VoucherNumberLink id={v.id} number={v.number} /></td>',
      ],
    ],
  },
  {
    file: "match-statement/page.tsx",
    replaces: [
      [
        "{e.voucherNumber} · {e.voucherType}",
        '<VoucherNumberLink id={e.voucherId} number={e.voucherNumber} />{" "}· {e.voucherType}',
      ],
    ],
  },
];

for (const p of patches) {
  const fp = path.join(root, p.file);
  let s = fs.readFileSync(fp, "utf8");
  if (!s.includes("VoucherNumberLink")) {
    const m = s.match(/^import .+ from "@\/.+";/m);
    if (m) s = s.replace(m[0], m[0] + "\n" + importLine);
    else s = importLine + "\n" + s;
  }
  for (const [a, b] of p.replaces) {
    if (!s.includes(a)) {
      console.warn("MISS", p.file, a.slice(0, 60));
      continue;
    }
    s = s.split(a).join(b);
  }
  fs.writeFileSync(fp, s);
  console.log("OK", p.file);
}
