"use client";

// Small fetch helpers for client components. Errors carry the server's message.
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`, res.status);
  return body as T;
}

export const getJson = <T>(url: string, init?: RequestInit) => fetch(url, init).then((r) => handle<T>(r));

export const sendJson = <T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) =>
  fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
