import { NextRequest, NextResponse } from "next/server";
import { publicOrigin, publicRedirect } from "./public-origin";

/** Same-origin in-app navigations skip the WhatsApp bridge. */
export function shouldOpenAppBridge(req: NextRequest): boolean {
  const site = (req.headers.get("sec-fetch-site") || "").toLowerCase();
  return site !== "same-origin";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Try the installed TT PWA first (Android intent); otherwise the website. */
export function openAppOrWebsite(
  req: NextRequest,
  destPath: string,
  title = "T T Enterprises"
): NextResponse {
  if (!shouldOpenAppBridge(req)) {
    return publicRedirect(req, destPath);
  }
  const dest = new URL(
    destPath.startsWith("/") ? destPath : `/${destPath}`,
    `${publicOrigin(req)}/`
  ).href;
  const hi = req.cookies.get("NEXT_LOCALE")?.value === "hi";
  const heading = hi ? "TT ऐप खुल रहा है…" : "Opening TT app…";
  const blurb = hi
    ? "ऐप इंस्टॉल है तो पहले ऐप खुलेगा। नहीं तो वेबसाइट चलाएँ।"
    : "If the app is installed it will open first. Otherwise use the website.";
  const appLabel = hi ? "TT ऐप खोलें" : "Open in TT app";
  const webLabel = hi ? "वेबसाइट पर जारी रखें" : "Continue on website";
  const safeTitle = escapeHtml(title.slice(0, 80));
  const destJs = JSON.stringify(dest);
  const destHtml = escapeHtml(dest);
  const html = `<!DOCTYPE html>
<html lang="${hi ? "hi" : "en"}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${safeTitle}</title>
<meta property="og:title" content="${safeTitle}"/>
<meta property="og:description" content="${escapeHtml(blurb)}"/>
<meta http-equiv="refresh" content="8;url=${destHtml}"/>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#faf6f5;color:#2c1f1f;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:22rem;width:100%;background:#fff;border:2px solid #eadcda;border-radius:1.25rem;padding:1.25rem;text-align:center}
  h1{margin:0 0 .5rem;font-size:1.15rem}
  p{margin:0 0 1rem;color:#7a6565;font-size:.9rem;line-height:1.4}
  a{display:block;width:100%;box-sizing:border-box;border-radius:999px;padding:.75rem 1rem;font-weight:700;text-decoration:none;margin-top:.5rem}
  .app{background:#ff3131;color:#fff}
  .web{background:#fff;color:#ff3131;border:2px solid #ff3131}
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(blurb)}</p>
  <a class="app" id="app" href="${destHtml}">${escapeHtml(appLabel)}</a>
  <a class="web" href="${destHtml}">${escapeHtml(webLabel)}</a>
</div>
<script>
(function(){
  var dest = ${destJs};
  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {}
  if (standalone) { location.replace(dest); return; }
  var ua = navigator.userAgent || "";
  var android = /Android/i.test(ua);
  var app = document.getElementById("app");
  function goWeb() {
    if (document.hidden) return;
    location.replace(dest);
  }
  function goApp() {
    if (!android) { location.replace(dest); return; }
    try {
      var u = new URL(dest);
      var intent = "intent://" + u.host + u.pathname + u.search + u.hash
        + "#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url="
        + encodeURIComponent(u.href) + ";end";
      location.href = intent;
    } catch (e) {
      location.replace(dest);
    }
  }
  if (app) app.addEventListener("click", function(ev){ ev.preventDefault(); goApp(); });
  goApp();
  setTimeout(goWeb, 1600);
})();
</script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}
