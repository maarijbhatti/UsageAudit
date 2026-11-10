import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (path[0] !== "v1")
    return Response.json({ error: { detail: "Not found" } }, { status: 404 });
  const headers = new Headers();
  for (const key of [
    "cookie",
    "content-type",
    "content-length",
    "x-csrf-token",
    "x-organization-id",
    "origin",
  ]) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
    init.duplex = "half";
  }
  try {
    const upstream = await fetch(
      `${process.env.API_ORIGIN ?? "http://127.0.0.1:4000"}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`,
      init,
    );
    const responseHeaders = new Headers();
    for (const key of ["content-type", "content-disposition", "retry-after"]) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    for (const cookie of upstream.headers.getSetCookie())
      responseHeaders.append("set-cookie", cookie);
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: { detail: "The API is unavailable. Please retry shortly." } },
      { status: 502 },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as DELETE,
  proxy as PATCH,
  proxy as PUT,
};
