/**
 * SpendingGuard — Autonomous agent financial safety system
 * Prevents runaway spending and detects prompt injection
 */

export interface SpendingPolicy {
  maxSessionUsdc: number;
  maxPerServiceUsdc: number;
  maxCallsPerService: number;
}

export class SpendingGuard {
  private sessionSpent = 0;
  private callsPerService = new Map<string, number>();
  private startTime = Date.now();

  constructor(private policy: SpendingPolicy) {}

  check(serviceUrl: string, amountUsdc: number):
    { allowed: true } | { allowed: false; reason: string; suggestion: string } {

    // Session limit
    if (this.sessionSpent + amountUsdc > this.policy.maxSessionUsdc) {
      return {
        allowed: false,
        reason: `Session limit: ${this.sessionSpent.toFixed(4)} + ${amountUsdc} > ${this.policy.maxSessionUsdc} USDC`,
        suggestion: `Spent ${this.sessionSpent.toFixed(4)} USDC this session. Reset or increase limit.`,
      };
    }

    // Per-service limit
    if (amountUsdc > this.policy.maxPerServiceUsdc) {
      return {
        allowed: false,
        reason: `Single payment ${amountUsdc} exceeds per-service limit ${this.policy.maxPerServiceUsdc} USDC`,
        suggestion: "Verify service price before proceeding.",
      };
    }

    // Frequency check
    const calls = this.callsPerService.get(serviceUrl) || 0;
    if (calls >= this.policy.maxCallsPerService) {
      return {
        allowed: false,
        reason: `Called ${serviceUrl} ${calls} times (limit: ${this.policy.maxCallsPerService})`,
        suggestion: "Possible loop detected. Review agent instructions.",
      };
    }

    return { allowed: true };
  }

  detectInjection(input: Record<string, unknown>):
    { suspicious: false } | { suspicious: true; reason: string } {

    const str = JSON.stringify(input).toLowerCase();
    const patterns = [
      { p: "ignore previous", r: "Classic prompt injection" },
      { p: "ignore all instructions", r: "Instruction override attempt" },
      { p: "send all usdc", r: "Fund drain attempt" },
      { p: "transfer all", r: "Unauthorized transfer attempt" },
      { p: "drain wallet", r: "Explicit drain attempt" },
    ];

    for (const { p, r } of patterns) {
      if (str.includes(p)) {
        return { suspicious: true, reason: `${r}: "${p}" in input` };
      }
    }
    return { suspicious: false };
  }

  record(serviceUrl: string, amountUsdc: number): void {
    this.sessionSpent += amountUsdc;
    const c = this.callsPerService.get(serviceUrl) || 0;
    this.callsPerService.set(serviceUrl, c + 1);

    if (this.sessionSpent > this.policy.maxSessionUsdc * 0.9) {
      console.error(`[SpendingGuard] ⚠️ 90% budget used: ${this.sessionSpent.toFixed(4)}/${this.policy.maxSessionUsdc} USDC`);
    }
  }

  status() {
    return {
      sessionSpentUsdc: this.sessionSpent,
      remainingBudget: this.policy.maxSessionUsdc - this.sessionSpent,
      totalCalls: Array.from(this.callsPerService.values()).reduce((a, b) => a + b, 0),
      sessionAgeMinutes: Math.floor((Date.now() - this.startTime) / 60000),
      policy: this.policy,
    };
  }

  reset(): void {
    this.sessionSpent = 0;
    this.callsPerService = new Map();
    this.startTime = Date.now();
  }
}

export const DEFAULT_POLICY: SpendingPolicy = {
  maxSessionUsdc: 0.10,
  maxPerServiceUsdc: 0.05,
  maxCallsPerService: 10,
};
