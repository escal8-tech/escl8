import { SUPPORTED_SOURCES } from "@/../drizzle/schema";

// Re-export Source type from schema
export type Source = (typeof SUPPORTED_SOURCES)[number];

// Configuration for each source (colors, icons, labels)
export const SOURCE_CONFIG: Record<
  Source,
  { label: string; color: string; bgColor: string; icon: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    color: "#25D366",
    bgColor: "bg-green-100 text-green-800",
    icon: "💬",
  },
  shopee: {
    label: "Shopee",
    color: "#EE4D2D",
    bgColor: "bg-orange-100 text-orange-800",
    icon: "🛒",
  },
  lazada: {
    label: "Lazada",
    color: "#0F146D",
    bgColor: "bg-indigo-100 text-indigo-800",
    icon: "🛍️",
  },
  telegram: {
    label: "Telegram",
    color: "#0088CC",
    bgColor: "bg-sky-100 text-sky-800",
    icon: "✈️",
  },
  instagram: {
    label: "Instagram",
    color: "#E4405F",
    bgColor: "bg-pink-100 text-pink-800",
    icon: "📸",
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    bgColor: "bg-blue-100 text-blue-800",
    icon: "👤",
  },
  email: {
    label: "Email",
    color: "#EA4335",
    bgColor: "bg-red-100 text-red-800",
    icon: "📧",
  },
  web: {
    label: "Web",
    color: "#4285F4",
    bgColor: "bg-blue-100 text-blue-700",
    icon: "🌐",
  },
  other: {
    label: "Other",
    color: "#9CA3AF",
    bgColor: "bg-gray-100 text-gray-800",
    icon: "📋",
  },
};

export interface CustomerRow {
  id: string;
  businessId: string;
  source: Source;
  externalId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  platformMeta: Record<string, unknown> | null;
  totalRequests: number;
  totalRevenue: string;
  successfulRequests: number;
  leadScore: number;
  isHighIntent: boolean;
  lastSentiment: string | null;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  tags: string[];
  notes: string | null;
  assignedToUserId: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerWithRequests extends CustomerRow {
  requests: {
    id: string;
    sentiment: string;
    resolutionStatus: string;
    source: Source;
    customerId: string | null;
    customerNumber: string | null;
    price: string | null;
    paid: boolean;
    summary: string | null;
    createdAt: Date;
  }[];
}

