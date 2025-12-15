export type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

export type RequestRow = {
  id: string;
  customerNumber: string;
  sentiment: string | null;
  resolutionStatus: string | null;
  price: number | null;
  paid: boolean;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  summary?: unknown;
  needsFollowup?: boolean;
  paymentDetails?: string | null;
  text?: string | null;
};

export type StatsTotals = {
  count?: number;
  revenue?: number;
  paidCount?: number;
  deflectionRate?: number;
  followUpRate?: number;
};