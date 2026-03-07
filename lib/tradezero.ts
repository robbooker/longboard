export interface TZAccount {
  account: string;
  accountStatus: string;
  accountType: string;
  availableCash: number;
  buyingPower: number;
  equity: number;
  leverage: number;
  realized: number;
  sodEquity: number;
  sharesTraded: number;
  totalCommissions: number;
}

export interface TZPosition {
  accountId: string;
  symbol: string;
  shares: number;
  side: string;
  priceAvg: number;
  priceOpen: number;
  priceClose: number;
  securityType: string;
  dayOvernight: string;
  createdDate: string;
}

export interface TZPortfolioData {
  account: TZAccount;
  positions: TZPosition[];
  fetchedAt: string;
}

export async function fetchTZPortfolio(): Promise<TZPortfolioData> {
  const res = await fetch("/api/tradezero", { cache: "no-store" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch TradeZero portfolio (${res.status})`);
  }

  return res.json();
}
