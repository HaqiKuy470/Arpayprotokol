export const settlementQueue = new Map<
  string,
  {
    status: string;
    communityId: string;
    idrAmount: number;
    usdcAmount: number;
    nonce: number;
    escrowPDA: string;
    sponsorPubkey: string;
    bifastRef?: string;
    createdAt: number;
    processedAt?: number;
  }
>();