import { NextResponse } from "next/server";

const WIDGET_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export function widgetCorsHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...WIDGET_CORS_HEADERS,
    ...(extra || {}),
  };
}

export function widgetOptionsResponse() {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(),
  });
}

export function widgetJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: widgetCorsHeaders(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined),
  });
}
