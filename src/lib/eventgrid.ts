import { EventGridPublisherClient, AzureKeyCredential } from "@azure/eventgrid";

const endpoint = process.env.EVENT_GRID_ENDPOINT || "";
const key = process.env.EVENT_GRID_KEY || "";

export const eventGridClient: EventGridPublisherClient<unknown> | null = endpoint && key
  ? new EventGridPublisherClient(endpoint, 'EventGrid', new AzureKeyCredential(key))
  : null;

export async function publishEvent(eventType: string, subject: string, data: unknown) {
  if (!eventGridClient) {
    console.warn("Event Grid is not configured. Event not published:", eventType);
    return;
  }
  try {
    await eventGridClient.send([{
      eventType,
      subject,
      dataVersion: "1.0",
      data,
      eventTime: new Date()
    }]);
  } catch (error) {
    console.error("Failed to publish event to Event Grid:", error);
  }
}
