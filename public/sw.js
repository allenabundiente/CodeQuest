/* CodeQuest service worker — prompt mode.
 *
 * - Install precaches a complete shell into a new versioned cache. If any
 *   precache request fails the whole install fails, so a half-downloaded
 *   shell can never activate.
 * - The worker never calls skipWaiting on its own: the page shows a banner and
 *   posts SKIP_WAITING when the learner taps "Update now".
 * - Activate removes older shell caches only after the new one is complete,
 *   which keeps the previous version available until the swap succeeds.
 * - Navigations are network-first with an offline fallback; API routes are
 *   never cached; immutable Next chunks are cached-first with revalidation.
 */

const BOOT_CACHE = "codequest-shell-boot";
const SHELL_PREFIX = "codequest-shell-";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/maskable.svg",
];

let activeCacheName = BOOT_CACHE;

async function resolveCacheName() {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return BOOT_CACHE;
    const data = await response.json();
    const app = String(data.appVersion || "0").replace(/[^a-zA-Z0-9._-]/g, "-");
    const content = String(data.contentVersion ?? 0);
    return `${SHELL_PREFIX}${app}-${content}`;
  } catch {
    return BOOT_CACHE;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      activeCacheName = await resolveCacheName();
      const cache = await caches.open(activeCacheName);
      // addAll is atomic: a single failure rejects the install.
      await cache.addAll(PRECACHE);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(SHELL_PREFIX) &&
              key !== activeCacheName &&
              key !== BOOT_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses and RSC payloads must always come from the network.
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match("/offline.html");
          return (
            cached ??
            new Response("CodeQuest is offline.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(activeCacheName);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      })(),
    );
  }
});
