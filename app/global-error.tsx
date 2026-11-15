"use client";

import Link from "next/link";
import { useEffect } from "react";
import { captureException } from "@/lib/sentry";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void captureException(error, {
      route: "global-error",
      tags: { digest: error.digest ?? "none" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#070a0f",
          color: "#e9eff7",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          textAlign: "center",
        }}
      >
        <main
          style={{
            maxWidth: 460,
            padding: 32,
            border: "1px solid #202d3c",
            borderRadius: 20,
            background: "#101722",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#7cf29c",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            CodeQuest
          </p>
          <h1 style={{ fontSize: 24, margin: "10px 0 12px" }}>
            Something broke on this screen.
          </h1>
          <p style={{ color: "#8ea1b6", lineHeight: 1.6, fontSize: 14 }}>
            The error was reported. Your saved lessons and drafts are safe —
            retry this screen, or head back to the dashboard.
          </p>
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "center",
              marginTop: 20,
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "11px 18px",
                borderRadius: 10,
                border: 0,
                background: "#7cf29c",
                color: "#062c17",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                padding: "11px 18px",
                borderRadius: 10,
                border: "1px solid #2d4054",
                color: "#e9eff7",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Dashboard
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
