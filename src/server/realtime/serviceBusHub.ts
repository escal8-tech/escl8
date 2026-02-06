import { EventEmitter } from "events";

type PortalEvent = {
  businessId: string;
  entity: string;
  op: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

type Handler = (event: PortalEvent) => void;

class ServiceBusHub {
  private emitter = new EventEmitter();
  private client: any = null;
  private receiver: any = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private subscribers = 0;
  private readonly debug = true;
  private receivedCount = 0;
  private emittedCount = 0;

  private log(msg: string, ...args: unknown[]) {
    if (!this.debug) return;
    console.log(`[realtime:hub] ${msg}`, ...args);
  }

  subscribe(handler: Handler) {
    this.emitter.on("event", handler);
    this.subscribers += 1;
    this.log("subscriber added; total=%d", this.subscribers);
    this.ensureStarted();

    return () => {
      this.emitter.off("event", handler);
      this.subscribers = Math.max(0, this.subscribers - 1);
      this.log("subscriber removed; total=%d", this.subscribers);
      if (this.subscribers === 0) {
        void this.stop();
      }
    };
  }

  private async ensureStarted() {
    if (this.running) return;

    const conn = process.env.SERVICE_BUS_CONN || process.env.SERVICEBUS_CONNECTION_STRING || "";
    const topic = process.env.SERVICE_BUS_TOPIC_NAME || "portal-events";
    const subscription = process.env.SERVICE_BUS_SUBSCRIPTION_NAME || "portal-dashboard";

    if (!conn) {
      this.log("SERVICE_BUS_CONN missing; hub disabled");
      return;
    }

    let ServiceBusClientCtor: any;
    try {
      const req = eval("require") as NodeRequire;
      ServiceBusClientCtor = req("@azure/service-bus").ServiceBusClient;
    } catch {
      this.log("@azure/service-bus not installed; hub disabled");
      return;
    }

    this.client = new ServiceBusClientCtor(conn);
    this.receiver = this.client.createReceiver(topic, subscription, {
      receiveMode: "peekLock",
    });
    this.log("receiver started topic=%s subscription=%s", topic, subscription);

    this.running = true;
    this.loopPromise = this.runLoop();
  }

  private async stop() {
    this.running = false;

    try {
      await this.loopPromise;
    } catch {
      // ignore
    }

    this.loopPromise = null;

    if (this.receiver) {
      try {
        await this.receiver.close();
      } catch {
        // ignore
      }
      this.receiver = null;
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.log("receiver stopped");
  }

  private async runLoop() {
    while (this.running && this.receiver) {
      try {
        const messages = await this.receiver.receiveMessages(25, {
          maxWaitTimeInMs: 5000,
        });

        if (!messages.length) continue;

        for (const message of messages) {
          await this.handleMessage(message);
        }
      } catch {
        this.log("receive loop error; retrying");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private parseMessageBody(message: any): PortalEvent | null {
    try {
      const body = message.body;
      if (typeof body === "string") return JSON.parse(body) as PortalEvent;
      if (body && typeof body === "object") return body as PortalEvent;
      return null;
    } catch {
      return null;
    }
  }

  private async handleMessage(message: any) {
    if (!this.receiver) return;
    this.receivedCount += 1;

    const event = this.parseMessageBody(message);
    if (!event || !event.businessId) {
      this.log("dropping invalid message; received=%d", this.receivedCount);
      await this.receiver.completeMessage(message);
      return;
    }

    this.emitter.emit("event", event);
    this.emittedCount += 1;
    this.log(
      "event emitted businessId=%s entity=%s op=%s totals(received=%d,emitted=%d)",
      event.businessId,
      event.entity,
      event.op,
      this.receivedCount,
      this.emittedCount,
    );
    await this.receiver.completeMessage(message);
  }
}

export const serviceBusHub = new ServiceBusHub();
export type { PortalEvent };
