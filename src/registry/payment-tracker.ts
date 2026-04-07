export interface PaymentRecord {
  id: string;               // uuid
  timestamp: string;        // ISO string
  serviceName: string;      
  serviceUrl: string;       
  amountUsdc: string;       // human readable e.g. "0.001"
  txHash: string;           // Stellar transaction hash from facilitator response
  payerAddress: string;     // paying wallet address
  stellarExplorerUrl: string; // https://stellar.expert/explorer/testnet/tx/<txHash>
  success: boolean;
}

export class PaymentTracker {
  private records: PaymentRecord[] = [];
  private readonly MAX_RECORDS = 100;

  record(entry: Omit<PaymentRecord, "id" | "stellarExplorerUrl">): PaymentRecord {
    const network = process.env.STELLAR_NETWORK || "stellar:testnet";
    const explorerNet = network === "stellar:pubnet" ? "public" : "testnet";
    const record: PaymentRecord = {
      ...entry,
      id: Math.random().toString(36).slice(2),
      stellarExplorerUrl: `https://stellar.expert/explorer/${explorerNet}/tx/${entry.txHash}`,
    };
    this.records.unshift(record);
    if (this.records.length > this.MAX_RECORDS) this.records.pop();
    return record;
  }

  getAll(): PaymentRecord[] { return [...this.records]; }
  
  getStats(): { total: number; totalUsdc: number; successRate: number } {
    const total = this.records.length;
    const successful = this.records.filter(r => r.success).length;
    const totalUsdc = this.records
      .filter(r => r.success)
      .reduce((sum, r) => sum + parseFloat(r.amountUsdc), 0);
    return {
      total,
      totalUsdc: Math.round(totalUsdc * 1_000_000) / 1_000_000,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
    };
  }
}

export const globalPaymentTracker = new PaymentTracker();
