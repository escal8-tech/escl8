export type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

export type Source = 'whatsapp' | 'shopee' | 'lazada' | 'telegram' | 'instagram' | 'facebook' | 'email' | 'web' | 'other';

export type RequestRow = {
  id: string;
  customerId?: string | null;
  customerNumber: string | null;
  sentiment: string | null;
  status?: string | null;
  type?: string | null;
  source?: string; // whatsapp | shopee | lazada | etc.
  price: number | string | null;
  paid: boolean;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  summary?: unknown;
  needsFollowup?: boolean;
  paymentDetails?: string | null;
  text?: string | null;
  botPaused?: boolean;
};

export type StatsTotals = {
  count?: number;
  revenue?: number;
  paidCount?: number;
  deflectionRate?: number;
  followUpRate?: number;
};

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
