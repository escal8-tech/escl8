import { NextResponse } from "next/server";

// This endpoint receives the authorization code from Facebook Embedded Signup
// along with the WhatsApp Business Account (WABA) ID and Phone Number ID.
// TODO: Exchange the code for a System User access token on the server, then
// - Verify/lookup the WABA and phone number
// - Subscribe the phone number to your app
// - Configure the webhook callback URL and verification token
// - Persist the connection against the authenticated user

export async function POST(req: Request) {
  try {
    const { code, wabaId, phoneNumberId } = (await req.json()) as {
      code?: string;
      wabaId?: string;
      phoneNumberId?: string;
    };
    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json({ error: "Missing code, wabaId or phoneNumberId" }, { status: 400 });
    }

    // For now, just log and acknowledge. Replace with real integration.
    console.log("[WhatsApp Sync] Received:", { wabaId, phoneNumberId, code: code.slice(0, 6) + "…" });

    // Placeholder response
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[WhatsApp Sync] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
