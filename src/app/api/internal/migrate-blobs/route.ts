import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== "migrate123") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = await (db as any).session.client;

    // We do regex replaces for the known categories
    // Old pattern: .../uploads/businessId/CATEGORY/file...
    // New pattern: .../uploads/CATEGORY/businessId/file...
    
    // orders.invoice_url
    await client.query(`
      UPDATE orders 
      SET invoice_url = regexp_replace(invoice_url, 'uploads/([a-zA-Z0-9\-]+)/INVOICE/', 'uploads/INVOICE/\\1/', 'g') 
      WHERE invoice_url LIKE '%/INVOICE/%';
    `);

    // order_payments.proof_url
    await client.query(`
      UPDATE order_payments 
      SET proof_url = regexp_replace(proof_url, 'uploads/([a-zA-Z0-9\-]+)/order-payments/', 'uploads/order-payments/\\1/', 'g') 
      WHERE proof_url LIKE '%/order-payments/%';
    `);

    // agent_documents.document_url
    await client.query(`
      UPDATE agent_documents 
      SET document_url = regexp_replace(document_url, 'uploads/([a-zA-Z0-9\-]+)/AGENT_DOC/', 'uploads/AGENT_DOC/\\1/', 'g') 
      WHERE document_url LIKE '%/AGENT_DOC/%';
    `);

    // agent_messages.media_url
    await client.query(`
      UPDATE agent_messages 
      SET media_url = regexp_replace(media_url, 'uploads/([a-zA-Z0-9\-]+)/thread-media/', 'uploads/thread-media/\\1/', 'g') 
      WHERE media_url LIKE '%/thread-media/%';
    `);

    // agent_messages.blob_path (doesn't contain uploads/)
    await client.query(`
      UPDATE agent_messages 
      SET blob_path = regexp_replace(blob_path, '^([a-zA-Z0-9\-]+)/thread-media/', 'thread-media/\\1/', 'g') 
      WHERE blob_path LIKE '%/thread-media/%';
    `);

    // businesses.settings (JSONB)
    await client.query(`
      UPDATE businesses 
      SET settings = (
        regexp_replace(
          settings::text, 
          'uploads/([a-zA-Z0-9\-]+)/logos/', 
          'uploads/logos/\\1/', 
          'g'
        )
      )::jsonb 
      WHERE settings::text LIKE '%/logos/%';
    `);

    await client.query(`
      UPDATE businesses 
      SET settings = (
        regexp_replace(
          settings::text, 
          'uploads/([a-zA-Z0-9\-]+)/public/', 
          'uploads/public/\\1/', 
          'g'
        )
      )::jsonb 
      WHERE settings::text LIKE '%/public/%';
    `);

    return NextResponse.json({ success: true, message: "Migration completed" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
