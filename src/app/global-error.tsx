"use client";

/**
 * Root error boundary — hard Reload / Back / Home so navigation never dies.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f5f0",
          color: "#0b3d2e",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>
            This page couldn&apos;t load
          </h1>
          <p style={{ fontSize: 14, color: "#5c6b66", marginBottom: 20 }}>
            Reload or go Back to continue. These buttons always work.
          </p>
          {error?.digest ? (
            <p style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>
              Ref: {error.digest}
            </p>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              style={{
                background: "#0b3d2e",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onClick={() => {
                try {
                  unstable_retry();
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
            >
              Reload
            </button>
            <button
              type="button"
              style={{
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else window.location.href = "/";
              }}
            >
              Back
            </button>
            {/* Hard navigation on purpose — the app shell has crashed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                padding: "10px 16px",
                fontWeight: 600,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
