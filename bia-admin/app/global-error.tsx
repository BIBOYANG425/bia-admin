"use client";

// Root error boundary — replaces the root layout when the layout itself throws,
// so it must render its own <html>/<body> and cannot rely on Tailwind being
// applied. Inline styles keep it self-contained.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            出错了
          </h2>
          <p style={{ color: "#71717a", fontSize: "0.875rem", marginTop: 4 }}>
            应用发生了意外错误。
            {error.digest ? ` (${error.digest})` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              height: 36,
              padding: "0 16px",
              borderRadius: 6,
              border: "none",
              background: "#18181b",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
