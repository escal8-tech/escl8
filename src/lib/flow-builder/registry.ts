export type FlowAgentId = string;
export type FlowModuleStatus = "live" | "review" | "draft";

export type FlowModuleSetting = {
  label: string;
  value: string;
  tone?: "good" | "warn" | "muted";
  editable?: boolean;
};

export type FlowModuleManifest = {
  id: string;
  runtimeKey: string;
  title: string;
  type: string;
  summary: string;
  status: FlowModuleStatus;
  position: { x: number; y: number };
  channels: string[];
  integrations: string[];
  settings: FlowModuleSetting[];
  debug: {
    phase: string;
    llmCalls: string[];
    stateKeys: string[];
    emits: string[];
  };
};

export type FlowRouteManifest = {
  name: string;
  from: string;
  to: string;
  condition: string;
  channel: string;
};

export type FlowAgentManifest = {
  id: FlowAgentId;
  name: string;
  channel: string;
  botType: "AGENT" | "ORDER" | "BOOKING" | "CONCIERGE";
  owned: number;
  health: string;
  description: string;
  runtimeGraph: string;
  routes: FlowRouteManifest[];
  modules: FlowModuleManifest[];
};

export type FlowBuilderManifest = {
  version: string;
  source: string;
  fallback?: boolean;
  agents: FlowAgentManifest[];
};

export const flowModuleStatusLabel: Record<FlowModuleStatus, string> = {
  live: "Live",
  review: "Needs review",
  draft: "Draft",
};

export const flowModulePalette = [
  "Field Collector",
  "Payment Gate",
  "Human Handoff",
  "Reminder",
  "API Action",
  "Knowledge Reply",
  "Media Sender",
  "SLA Timer",
];

export const flowBuilderAgents: FlowAgentManifest[] = [
  {
    id: "whatsapp-order",
    name: "WhatsApp Sales Agent",
    channel: "WhatsApp",
    botType: "ORDER",
    owned: 4,
    health: "Production ready",
    runtimeGraph: "bot.answer_flow.langgraph.order",
    description: "Finds products, confirms buying intent, builds carts, collects delivery details, and moves orders to staff approval.",
    routes: [
      { name: "Product discovery", from: "Inbound message", to: "Knowledge retrieval", condition: "User asks for items, prices, photos, or comparisons", channel: "WhatsApp" },
      { name: "Purchase confirmation", from: "Item confirmation", to: "Cart builder", condition: "User clearly confirms the item and price option", channel: "WhatsApp" },
      { name: "Manual approval", from: "Cart finalized", to: "Order queue", condition: "Customer confirms final cart", channel: "Dashboard" },
      { name: "Payment follow-up", from: "Order approved", to: "Payment status", condition: "Delivery or pickup details are saved", channel: "WhatsApp" },
    ],
    modules: [
      {
        id: "wa-entry",
        runtimeKey: "pipeline.inbound_media_and_text",
        title: "Inbound WhatsApp",
        type: "Channel trigger",
        summary: "Receives text, images, documents, captions, and manual staff messages.",
        status: "live",
        position: { x: 36, y: 86 },
        channels: ["WhatsApp"],
        integrations: ["Meta Cloud API", "Blob Storage"],
        settings: [
          { label: "Identity", value: "+94 72 695 7000", tone: "good", editable: true },
          { label: "AI mode", value: "Active unless disabled", editable: true },
          { label: "Media handling", value: "Save to blob, analyze images, show in Messages" },
        ],
        debug: {
          phase: "ingress",
          llmCalls: [],
          stateKeys: ["request_meta", "latest_image_analysis", "message_type"],
          emits: ["thread_message.created", "media.staged"],
        },
      },
      {
        id: "intent-router",
        runtimeKey: "answer_flow.context_status.intent_router",
        title: "Intent Router",
        type: "AI decision",
        summary: "Classifies browsing, buying intent, order edits, payment updates, and support requests.",
        status: "live",
        position: { x: 326, y: 58 },
        channels: ["WhatsApp", "Dashboard"],
        integrations: ["OpenAI", "Conversation State"],
        settings: [
          { label: "Escalation rule", value: "Specific item + confirmed buying intent", editable: true },
          { label: "Order edits", value: "Allowed before payment approval", editable: true },
          { label: "Language handling", value: "English, Sinhala, Tamil, mixed chat" },
        ],
        debug: {
          phase: "context_status",
          llmCalls: ["request_optimizer", "intent_classifier", "purchase_confirmation_judge"],
          stateKeys: ["open_question", "pending_agent_purchase_item", "route_intent"],
          emits: ["intent.resolved", "state.updated"],
        },
      },
      {
        id: "knowledge",
        runtimeKey: "answer_flow.retrieval.inventory_grounding",
        title: "Inventory + Knowledge",
        type: "Retrieval",
        summary: "Grounds replies from product sheets, policies, image links, pricing fields, and store docs.",
        status: "live",
        position: { x: 612, y: 92 },
        channels: ["Documents"],
        integrations: ["Pinecone", "Azure Blob", "RAG Worker"],
        settings: [
          { label: "Product fields", value: "Name, price, special prices, image links, stock notes" },
          { label: "Strict grounding", value: "Enabled", tone: "good", editable: true },
          { label: "Photo reply", value: "Send product image when URL is available", editable: true },
        ],
        debug: {
          phase: "retrieval",
          llmCalls: ["query_rewrite", "rerank"],
          stateKeys: ["contexts", "inventory_grounding_note", "offer_links"],
          emits: ["retrieval.completed"],
        },
      },
      {
        id: "cart",
        runtimeKey: "order_bot.cart_manager",
        title: "Cart Builder",
        type: "ORDER module",
        summary: "Adds, edits, removes, and reprices items before final order creation.",
        status: "review",
        position: { x: 322, y: 280 },
        channels: ["WhatsApp"],
        integrations: ["Orders API", "Dashboard"],
        settings: [
          { label: "Quantity required", value: "Yes", editable: true },
          { label: "Price option handling", value: "Normal, wholesale, member, warranty, custom columns", editable: true },
          { label: "Final confirmation", value: "Required before order row is created", editable: true },
        ],
        debug: {
          phase: "flow_dispatch",
          llmCalls: ["cart_action_judge", "price_option_resolver"],
          stateKeys: ["draft_items", "draft_total", "awaiting_price_choice", "awaiting_cart_completion"],
          emits: ["cart.item_added", "cart.item_updated", "cart.finalized"],
        },
      },
      {
        id: "approval",
        runtimeKey: "dashboard.orders.approval_queue",
        title: "Staff Approval",
        type: "Dashboard queue",
        summary: "Creates the filled order row for staff to approve, edit, deny, or send to payment.",
        status: "live",
        position: { x: 612, y: 308 },
        channels: ["Dashboard", "WhatsApp"],
        integrations: ["Order Queue", "Message Outbox"],
        settings: [
          { label: "Queue", value: "Orders" },
          { label: "Approval message", value: "Send delivery request, then payment details", editable: true },
          { label: "Deny behavior", value: "Close order and clear active state", editable: true },
        ],
        debug: {
          phase: "staff_action",
          llmCalls: [],
          stateKeys: ["order_status", "delivery_collection_state"],
          emits: ["order.approved", "order.denied", "message.outbox"],
        },
      },
      {
        id: "payment",
        runtimeKey: "post_approval.payment_delivery_state",
        title: "Payment + Delivery",
        type: "Post-approval",
        summary: "Collects name, phone, delivery area or pickup, then tracks payment confirmation.",
        status: "live",
        position: { x: 890, y: 196 },
        channels: ["WhatsApp", "Dashboard"],
        integrations: ["Payment Status", "Order Status", "Invoice PDF"],
        settings: [
          { label: "Slip enforcement", value: "Configurable", editable: true },
          { label: "Payment signal", value: "Text confirmation, image, PDF, or staff approval", editable: true },
          { label: "Pickup mode", value: "Name only, WhatsApp number as phone", editable: true },
        ],
        debug: {
          phase: "post_approval",
          llmCalls: ["delivery_details_extractor", "payment_or_edit_classifier"],
          stateKeys: ["delivery_details", "payment_status", "payment_proof_meta"],
          emits: ["payment.confirmed", "payment.invalid", "order.reopened_for_edit"],
        },
      },
    ],
  },
  {
    id: "booking-desk",
    name: "Reservation Desk",
    channel: "WhatsApp",
    botType: "BOOKING",
    owned: 2,
    health: "Ready for setup",
    runtimeGraph: "bot.answer_flow.langgraph.booking",
    description: "Collects booking details, checks rules, confirms reservation requests, and prepares reminders.",
    routes: [
      { name: "Availability check", from: "Date request", to: "Slot rules", condition: "Customer asks for dates, times, party size, or rooms", channel: "WhatsApp" },
      { name: "Reservation capture", from: "Slot selected", to: "Field collector", condition: "Customer wants to book", channel: "WhatsApp" },
      { name: "Staff confirmation", from: "Booking draft", to: "Bookings calendar", condition: "Required details are complete", channel: "Dashboard" },
    ],
    modules: [
      {
        id: "booking-entry",
        runtimeKey: "booking.channel_trigger",
        title: "Booking Trigger",
        type: "Channel trigger",
        summary: "Starts from WhatsApp, Instagram, or website reservation requests.",
        status: "live",
        position: { x: 52, y: 104 },
        channels: ["WhatsApp", "Instagram", "Widget"],
        integrations: ["Meta", "Website Widget"],
        settings: [
          { label: "Booking mode", value: "Request first, staff confirms", editable: true },
          { label: "Supported languages", value: "English + local mixed language" },
        ],
        debug: {
          phase: "ingress",
          llmCalls: ["booking_intent_classifier"],
          stateKeys: ["booking_intent", "requested_slot"],
          emits: ["booking.request_detected"],
        },
      },
      {
        id: "slot-rules",
        runtimeKey: "booking.slot_rules",
        title: "Slot Rules",
        type: "Rules engine",
        summary: "Applies business hours, blackout dates, party size, and lead-time limits.",
        status: "review",
        position: { x: 350, y: 68 },
        channels: ["Dashboard"],
        integrations: ["Bookings Calendar"],
        settings: [
          { label: "Business hours", value: "Editable per day", editable: true },
          { label: "Capacity", value: "Per service or location", editable: true },
          { label: "Reminder", value: "Optional WhatsApp reminder", editable: true },
        ],
        debug: {
          phase: "rules",
          llmCalls: [],
          stateKeys: ["business_hours", "capacity_rules", "blackout_dates"],
          emits: ["slot.validated"],
        },
      },
      {
        id: "booking-fields",
        runtimeKey: "booking.field_collector",
        title: "Field Collector",
        type: "AI form",
        summary: "Collects name, phone, date, time, party size, service, and notes conversationally.",
        status: "live",
        position: { x: 646, y: 168 },
        channels: ["WhatsApp"],
        integrations: ["OpenAI", "Bookings API"],
        settings: [
          { label: "Required fields", value: "Name, phone, date, time, party size", editable: true },
          { label: "Partial data", value: "Ask only for missing fields", editable: true },
          { label: "Confirmation", value: "Human approval or auto confirm", editable: true },
        ],
        debug: {
          phase: "field_collection",
          llmCalls: ["booking_field_extractor"],
          stateKeys: ["booking_details", "missing_fields"],
          emits: ["booking.draft_ready"],
        },
      },
      {
        id: "booking-calendar",
        runtimeKey: "dashboard.bookings.queue",
        title: "Booking Queue",
        type: "Dashboard queue",
        summary: "Shows pending reservations and lets staff approve, reschedule, or cancel.",
        status: "draft",
        position: { x: 902, y: 96 },
        channels: ["Dashboard", "WhatsApp"],
        integrations: ["Bookings", "Message Outbox"],
        settings: [
          { label: "Approval SLA", value: "15 minutes", editable: true },
          { label: "Reschedule flow", value: "Enabled", editable: true },
        ],
        debug: {
          phase: "staff_action",
          llmCalls: [],
          stateKeys: ["booking_status", "booking_id"],
          emits: ["booking.approved", "booking.rescheduled", "message.outbox"],
        },
      },
    ],
  },
  {
    id: "concierge",
    name: "Concierge Support",
    channel: "Instagram",
    botType: "CONCIERGE",
    owned: 3,
    health: "Draft",
    runtimeGraph: "bot.answer_flow.langgraph.concierge",
    description: "Answers questions, recommends services, routes support, and creates general tickets when human help is needed.",
    routes: [
      { name: "FAQ answer", from: "Customer question", to: "Knowledge response", condition: "Policy, location, warranty, delivery, or service info", channel: "Instagram" },
      { name: "Recommendation", from: "Need detected", to: "Suggestions", condition: "Customer asks what to choose", channel: "Instagram" },
      { name: "Human route", from: "Frustration or complex issue", to: "Support ticket", condition: "Needs staff help or account-specific handling", channel: "Dashboard" },
    ],
    modules: [
      {
        id: "ig-entry",
        runtimeKey: "concierge.channel_trigger",
        title: "Instagram Inbox",
        type: "Channel trigger",
        summary: "Handles DMs and comments that need concierge assistance.",
        status: "draft",
        position: { x: 54, y: 98 },
        channels: ["Instagram"],
        integrations: ["Meta"],
        settings: [
          { label: "Source", value: "Instagram DM", editable: true },
          { label: "Fallback", value: "Create support ticket", editable: true },
        ],
        debug: {
          phase: "ingress",
          llmCalls: ["support_intent_classifier"],
          stateKeys: ["source", "support_context"],
          emits: ["concierge.request_detected"],
        },
      },
      {
        id: "concierge-answer",
        runtimeKey: "concierge.answer_generation",
        title: "Concierge Brain",
        type: "AI response",
        summary: "Combines business docs, customer history, sentiment, and routing rules.",
        status: "review",
        position: { x: 350, y: 140 },
        channels: ["Instagram", "WhatsApp", "Dashboard"],
        integrations: ["OpenAI", "RAG", "Customer History"],
        settings: [
          { label: "Tone", value: "Human, concise, no bot disclosure", editable: true },
          { label: "Escalation", value: "General support when unresolved", editable: true },
        ],
        debug: {
          phase: "generation",
          llmCalls: ["answer_generation", "humanizer"],
          stateKeys: ["retrieved_context", "sentiment", "route_intent"],
          emits: ["reply.generated"],
        },
      },
      {
        id: "ticket-route",
        runtimeKey: "concierge.ticket_router",
        title: "Ticket Router",
        type: "Routing",
        summary: "Creates tickets for complaint, refund, warranty, cancellation, or general support.",
        status: "live",
        position: { x: 650, y: 102 },
        channels: ["Dashboard"],
        integrations: ["Ticket Ledger", "Messages"],
        settings: [
          { label: "Ticket types", value: "Complaint, refund, warranty, general support", editable: true },
          { label: "Human handoff", value: "Pause bot when staff owns thread", editable: true },
        ],
        debug: {
          phase: "flow_dispatch",
          llmCalls: ["ticket_type_classifier"],
          stateKeys: ["ticket_type", "ticket_active"],
          emits: ["ticket.created", "bot.paused"],
        },
      },
      {
        id: "gmail-alert",
        runtimeKey: "notifications.gmail_alert",
        title: "Gmail Alert",
        type: "Notification",
        summary: "Optional staff email alert for urgent concierge tickets.",
        status: "draft",
        position: { x: 912, y: 220 },
        channels: ["Email"],
        integrations: ["Gmail"],
        settings: [
          { label: "Urgency trigger", value: "Complaint or high frustration", editable: true },
          { label: "Recipient", value: "Support inbox", editable: true },
        ],
        debug: {
          phase: "notification",
          llmCalls: [],
          stateKeys: ["notification_policy", "priority"],
          emits: ["email.outbox"],
        },
      },
    ],
  },
];

export function cloneFlowModules(agentId: FlowAgentId): FlowModuleManifest[] {
  const agent = flowBuilderAgents.find((item) => item.id === agentId) ?? flowBuilderAgents[0];
  return agent.modules.map((module) => ({
    ...module,
    position: { ...module.position },
    channels: [...module.channels],
    integrations: [...module.integrations],
    settings: module.settings.map((setting) => ({ ...setting })),
    debug: {
      ...module.debug,
      llmCalls: [...module.debug.llmCalls],
      stateKeys: [...module.debug.stateKeys],
      emits: [...module.debug.emits],
    },
  }));
}
