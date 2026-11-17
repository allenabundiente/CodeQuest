import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppUpdatesProvider } from "@/components/pwa/AppUpdatesProvider";
import { AppShell } from "@/components/shell/AppShell";
import { loadActiveContent } from "@/lib/content/store";
import { svgToDataUri } from "@/lib/content/svg";
import { themeStyle } from "@/lib/content/theme";
import { buildDashboardRail } from "@/lib/dashboard";
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
  viewportFit: "cover",
  themeColor: "#070a0f",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const db = getDb();
  const content = loadActiveContent(db);
  const flags = getFeatureFlags();
  const pack = content.pack;
  const themeVars = themeStyle(pack.theme) as unknown as React.CSSProperties;
  const rail = user ? buildDashboardRail(db, user) : null;

  return (
    <html lang="en">
      <body style={themeVars}>
        <AppUpdatesProvider
          appVersion={APP_VERSION}
          contentUpdatesEnabled={flags.contentUpdates}
          pwaUpdatesEnabled={flags.pwaUpdates}
        >
          <AppShell
            user={
              user
                ? { email: user.email, name: user.name, role: user.role }
                : null
            }
            brandName={pack.copy.brandName}
            logoMark={svgToDataUri(pack.assets.logoMark)}
            rail={rail}
            footer={pack.copy.footer}
          >
            {children}
          </AppShell>
        </AppUpdatesProvider>
      </body>
    </html>
  );
}
