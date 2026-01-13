export type Source = 'whatsapp' | 'shopee' | 'lazada' | 'telegram' | 'instagram' | 'facebook' | 'email' | 'web' | 'other';

export interface CustomerRow {
  businessId: string;
  source: string; // The platform this customer came from
  externalId: string; // Platform-specific ID (phone for WhatsApp, shop ID for Shopee, etc.)
  name: string | null;
  email: string | null;
  phone: string | null;
  profilePictureUrl: string | null;
  platformMeta: Record<string, unknown> | null; // Platform-specific metadata
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerWithRequests extends CustomerRow {
  requests: {
    id: string;
    sentiment: string;
    resolutionStatus: string;
    source: string;
    price: string | null;
    paid: boolean;
    summary: string | null;
    createdAt: Date;
  }[];
}

// Source display configuration
export const SOURCE_CONFIG: Record<Source, { label: string; color: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#25D366', icon: '💬' },
  shopee: { label: 'Shopee', color: '#EE4D2D', icon: '🛒' },
  lazada: { label: 'Lazada', color: '#0F146D', icon: '🛍️' },
  telegram: { label: 'Telegram', color: '#0088CC', icon: '✈️' },
  instagram: { label: 'Instagram', color: '#E4405F', icon: '📸' },
  facebook: { label: 'Facebook', color: '#1877F2', icon: '👤' },
  email: { label: 'Email', color: '#EA4335', icon: '📧' },
  web: { label: 'Web Chat', color: '#6366F1', icon: '🌐' },
  other: { label: 'Other', color: '#94A3B8', icon: '📱' },
};

