/**
 * Launch smoke: public live endpoints + no-auth write rejection.
 * Does not log in or print secrets.
 */
const BASE = process.env.SMOKE_BASE || "https://tanmayphotos.space";

async function get(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    redirect: "follow",
    ...opts,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text, ok: res.ok };
}

const fail = [];
function check(name, ok, detail = "") {
  if (ok) console.log(`ok  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail.push(name);
  }
}

const catalog = await get("/api/db");
check(
  "GET /api/db public catalog",
  catalog.status === 200 &&
    catalog.json?.scope === "public" &&
    (catalog.json?.db?.products?.length ?? 0) >= 1,
  `${catalog.status} scope=${catalog.json?.scope} products=${catalog.json?.db?.products?.length ?? 0}`
);
check(
  "public catalog hides orders",
  catalog.status === 200 && (catalog.json?.db?.orders?.length ?? 0) === 0
);

const wa = await get("/api/whatsapp/send");
check(
  "WhatsApp configured",
  wa.status === 200 && wa.json?.configured === true,
  `${wa.status} mode=${wa.json?.mode}`
);

const session = await get("/api/account/login");
check(
  "GET /api/account/login without cookie",
  session.status === 401 && !session.json?.user,
  String(session.status)
);

const put = await get("/api/db", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ db: { products: [] } }),
});
check(
  "PUT /api/db without login rejected",
  put.status === 401,
  `${put.status} ${String(put.json?.error || "").slice(0, 80)}`
);

const home = await get("/en");
check("Home HTML", home.status === 200 && /T T Enterprises/i.test(home.text));

const catPage = await get("/en/catalog");
check("Catalog HTML", catPage.status === 200 && /Catalog/i.test(catPage.text));

const loginPage = await get("/en/login");
check("Login route", loginPage.status === 200);

if (fail.length) {
  console.error(`\n${fail.length} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nlaunch smoke passed");
