/**
 * spaPageHeader.ts
 *
 * Monkey-patches the global `fetch` once (at module load time) to attach an
 * `X-Spa-Page` request header to every outgoing API call. The backend's
 * monitoring middleware reads this header to attribute every request to the
 * SPA page the user was on when they triggered it — this is what powers the
 * "Requests by Page" charts in the Streamlit monitoring dashboard.
 *
 * Falls back gracefully if `window` / `location` / `fetch` are not available.
 */

function classifySpaPageFromLocation(): string {
  if (typeof window === "undefined" || !window.location) return "unknown";
  const p = (window.location.pathname || "/").toLowerCase();
  if (!p || p === "/" || p === "/home") return "home";
  if (p.startsWith("/upload")) return "upload";
  if (p.startsWith("/library")) return "library";
  if (p.startsWith("/collage") || p.startsWith("/generate")) return "collage";
  if (p.startsWith("/benchmark") || p.startsWith("/bench")) return "benchmark";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/analysis")) return "analysis";
  const first = p.split("/").filter(Boolean)[0];
  return first || "unknown";
}

type FetchLike = typeof fetch;

function installSpaPageFetchPatch() {
  if (typeof globalThis === "undefined") return;
  const g = globalThis as unknown as { fetch?: FetchLike };
  if (!g.fetch || (g.fetch as any).__spaPagePatched) return;

  const originalFetch = g.fetch.bind(g) as FetchLike;

  const patchedFetch: FetchLike = ((input: RequestInfo | URL, init?: RequestInit | undefined) => {
    const pageName = classifySpaPageFromLocation();
    const nextInit: RequestInit = { ...(init || {}) };
    const headers = new Headers(nextInit.headers || {});
    if (!headers.has("X-Spa-Page")) headers.set("X-Spa-Page", pageName);
    nextInit.headers = headers;
    return originalFetch(input, nextInit);
  }) as FetchLike;

  (patchedFetch as any).__spaPagePatched = true;
  g.fetch = patchedFetch;
}

installSpaPageFetchPatch();

export {};
