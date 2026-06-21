import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const events = await req.json();

    for (const event of events) {
      if (event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
        return NextResponse.json({
          validationResponse: event.data.validationCode,
        });
      }

      // Handle custom events
      if (event.eventType === 'order.placed') {
        // Handle heavy synchronous operations for order placed
        console.log("Processing order.placed event:", event.data);
      } else if (event.eventType === 'file.uploaded') {
        console.log("Processing file.uploaded event:", event.data);
      } else if (event.eventType === 'settings.updated') {
        console.log("Processing settings.updated event:", event.data);
      } else {
        console.log("Unhandled event type:", event.eventType);
      }
    }

    return NextResponse.json({ status: 'success' }, { status: 200 });
  } catch (error) {
    console.error('Error processing Event Grid webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
