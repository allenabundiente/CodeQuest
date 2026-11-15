import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { SignOutButton } from "@/components/SignOutButton";
import { AppUpdatesProvider } from "@/components/pwa/AppUpdatesProvider";
import { loadActiveContent } from "@/lib/content/store";
import { svgToDataUri } from "@/lib/content/svg";
import { themeStyle } from "@/lib/content/theme";
import { getDb } from "@/lib/db";
import { getFeatureFlags } from "@/lib/flags";
import { currentUser } from "@/lib/http";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CodeQuest — learn by building",
  description:
    "Turn your own code, PDFs, and GitHub repos into sandbox-verified programming lessons.",
  applicationName: "CodeQuest",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CodeQuest",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070a0f",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const content = loadActiveContent(getDb());
  const flags = getFeatureFlags();
  const pack = content.pack;
  const themeVars = themeStyle(pack.theme) as unknown as React.CSSProperties;

  return (
    <html lang="en">
      <body style={themeVars}>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgToDataUri(pack.assets.logoMark)} alt="" />
              </span>
              {pack.copy.brandName}
            </Link>
            <div className="topbar-actions">
              <nav className="nav" aria-label="Main">
                <Link href="/">Dashboard</Link>
                <Link href="/new" className="nav-cta">
                  New lesson
                </Link>
                {user ? (
                  <Link href="/settings">Settings</Link>
                ) : null}
                {user?.role === "developer" ? (
                  <Link href="/admin" className="nav-admin">
                    Admin
                  </Link>
                ) : null}
              </nav>
              {user ? (
                <div className="account">
                  <span className="account-email" title={user.email}>
                    {user.email}
                  </span>
                  <SignOutButton />
                </div>
              ) : (
                <Link href="/login" className="nav-signin">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <main className="page">
          <AppUpdatesProvider
            appVersion={APP_VERSION}
            contentUpdatesEnabled={flags.contentUpdates}
            pwaUpdatesEnabled={flags.pwaUpdates}
          >
            {children}
          </AppUpdatesProvider>
        </main>
        <footer className="footer">{pack.copy.footer}</footer>
      </body>
    </html>
  );
}
