import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      error: "SSE stream deprecated",
      message: "Use /api/events/negotiate with Web PubSub",
    },
    { status: 410 },
  );
}
