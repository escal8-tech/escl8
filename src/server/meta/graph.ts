/* eslint-disable @typescript-eslint/no-explicit-any */
export type GraphApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

export class MetaGraphError extends Error {
  public readonly status: number;
  public readonly graphError?: GraphApiError;
  public readonly endpoint: string;

  constructor(args: { status: number; endpoint: string; message: string; graphError?: GraphApiError }) {
    super(args.message);
    this.name = "MetaGraphError";
    this.status = args.status;
    this.endpoint = args.endpoint;
    this.graphError = args.graphError;
  }
}

function joinUrl(base: string, path: string) {
  if (!path) return base;
  if (path.startsWith("/")) return base + path;
  return base + "/" + path;
}

export async function graphJson<T>(args: {
  endpoint: string;
  method: "GET" | "POST" | "DELETE";
  accessToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
}): Promise<T> {
  const url = new URL(args.endpoint);
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (args.accessToken) {
    headers.Authorization = `Bearer ${args.accessToken}`;
  }
  if (args.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method: args.method,
    headers,
    body: args.json !== undefined ? JSON.stringify(args.json) : undefined,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const raw = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const graphError: GraphApiError | undefined =
      raw && typeof raw === "object" && "error" in raw && (raw as any).error && typeof (raw as any).error === "object"
        ? (raw as any).error
        : undefined;

    const msg =
      graphError?.message ??
      (typeof raw === "string" && raw.trim() ? raw.trim() : `Meta Graph API error (${res.status})`);

    throw new MetaGraphError({
      status: res.status,
      endpoint: url.toString(),
      message: msg,
      graphError,
    });
  }

  return raw as T;
}

export function graphBaseUrl(apiVersion: string): string {
  const v = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  return `https://graph.facebook.com/${v}`;
}

export function graphEndpoint(apiVersion: string, path: string): string {
  return joinUrl(graphBaseUrl(apiVersion), path);
}

