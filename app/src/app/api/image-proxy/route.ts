// GET /api/image-proxy?url=  Same-origin copy of a YouTube image (thumbnails, avatars)
// so canvases (Studio) can draw it without CORS taint. Only YouTube/Google image hosts.
const ALLOWED_HOSTS = [/(^|\.)ytimg\.com$/i, /(^|\.)ggpht\.com$/i, /(^|\.)googleusercontent\.com$/i];
const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return Response.json({ error: "A valid url parameter is required" }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol) || !ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return Response.json({ error: "Host not allowed" }, { status: 400 });
  }
  target.protocol = "https:";
  let upstream: Response;
  try {
    upstream = await fetch(target, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 HookLab image proxy" } });
  } catch {
    return Response.json({ error: "Image fetch failed" }, { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.startsWith("image/")) {
    return Response.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.ok ? 415 : upstream.status === 404 ? 404 : 502 });
  }
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "Image too large" }, { status: 413 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return Response.json({ error: "Image too large" }, { status: 413 });
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
