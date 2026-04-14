/** TradeZero account shape as returned by the proxy's /account/:id endpoint.
 *  Fields are typed against the live response captured 2026-04-14.
 *  Option-related fields are optional since non-options accounts may omit
 *  them. */
export interface TZAccount {
  account: string;
  accountStatus: string;
  accountType: string;
  availableCash: number;
  bp: number;
  equity: number;
  leverage: number;
  maintenanceDeficit: number;
  marginDeficit: number;
  marginRatio: number;
  overnightBp: number;
  realized: number;
  sharesTraded: number;
  sodEquity: number;
  totalCommissions: number;
  totalLocateCosts: number;
  usedLeverage: number;
  optContractsTraded?: number;
  optLevel?: number;
  optionCashTotalBalance?: number;
  optionTradingLevel?: number;
}

/** TradeZero open position as returned by the proxy's
 *  /accounts/:id/positions endpoint. Note: response comes wrapped in
 *  { positions: [...] } — the /api/tradezero* server routes unwrap before
 *  handing the array to the client. No last/mark/unrealized-P&L fields are
 *  returned by TZ; showing those requires a separate quote feed. */
export interface TZPosition {
  accountId: string;
  symbol: string;
  shares: number;
  side: "Long" | "Short";
  priceAvg: number;
  priceOpen: number;
  priceClose: number;
  priceStrike: number;
  putCall: string;
  securityType: string;
  positionId: string;
  createdDate: string;
  updatedDate: string;
  dayOvernight: string;
  maintenanceRequirement: number;
  marginRequirement: number;
  rootSymbol: string | null;
  tradedSymbol: string | null;
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
