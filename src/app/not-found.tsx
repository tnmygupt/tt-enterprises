export default function RootNotFound() {
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
          <p style={{ fontSize: 44, fontWeight: 700, margin: 0 }}>404</p>
          <h1 style={{ fontSize: 22, margin: "8px 0" }}>Page not found</h1>
          <p style={{ fontSize: 14, color: "#5c6b66", marginBottom: 20 }}>
            The link you opened has moved or no longer exists.
          </p>
          {/* Root 404 renders its own document — plain anchor, no router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/en"
            style={{
              background: "#0b3d2e",
              color: "#fff",
              borderRadius: 6,
              padding: "10px 18px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Go to TT Enterprises
          </a>
        </main>
      </body>
    </html>
  );
}
