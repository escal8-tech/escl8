export interface CustomerRow {
  businessId: string;
  waId: string;
  name: string | null;
  profilePictureUrl: string | null;
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
    price: string | null;
    paid: boolean;
    summary: string | null;
    createdAt: Date;
  }[];
}
