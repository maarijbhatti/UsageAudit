let refreshing: Promise<Response> | null = null;
export const selectedOrg = () =>
  typeof window === "undefined"
    ? ""
    : (localStorage.getItem("usageaudit.organization") ?? "");
const csrf = () =>
  typeof document === "undefined"
    ? ""
    : (document.cookie
        .split("; ")
        .find((c) => c.startsWith("ua_csrf="))
        ?.slice(8) ?? "");
export async function request(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("x-organization-id", selectedOrg());
  headers.set("x-csrf-token", csrf());
  if (options.body && !(options.body instanceof FormData))
    headers.set("content-type", "application/json");
  const res = await fetch("/api/v1/" + path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (
    res.status === 401 &&
    retry &&
    (!path.startsWith("auth/") || path === "auth/me")
  ) {
    refreshing ??= fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      credentials: "same-origin",
    }).finally(() => {
      refreshing = null;
    });
    const refreshed = await refreshing;
    if (refreshed.ok) return request(path, options, false);
  }
  return res;
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await request(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data: unknown = await res.json();
  if (!res.ok) {
    const e = data as {
      error?: { detail?: string | { message?: string | string[] } };
    };
    const detail = e.error?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : (detail?.message?.toString() ?? `Request failed (${res.status})`),
    );
  }
  return data as T;
}
export async function downloadReport(id: string) {
  const res = await request(`reports/${id}/download`);
  if (!res.ok) throw new Error("Report is unavailable");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `usageaudit-${id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
