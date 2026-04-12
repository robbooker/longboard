export interface TZOrder {
  orderId: string;
  accountId: string;
  symbol: string;
  side: string;
  qty: number;
  type: string;
  limitPrice: number | null;
  stopPrice: number | null;
  route: string;
  status: string;
  filledQty: number;
  avgFillPrice: number | null;
  createdAt: string;
}

export interface TZLocate {
  symbol: string;
  available: number;
  rate: string;
  costPerShare: string;
  tier: string;
}

export interface TZRoute {
  name: string;
  description: string;
  type: string;
}
