import { Injectable } from '@nestjs/common';

export type FakeZibalScenario =
  | 'success'
  | 'fail'
  | 'cancel'
  | 'timeout'
  | 'amount_mismatch'
  | 'verify_unavailable';

export interface FakeZibalTransaction {
  trackId: string;
  amountRial: number;
  orderId?: string;
  description?: string;
  callbackUrl?: string;
  scenario: FakeZibalScenario;
  paid: boolean;
  verified: boolean;
  verifyCount: number;
  createdAt: Date;
}

/**
 * In-memory transaction registry for the fake Zibal server.
 *
 * The fake exists so payment flows can be exercised over real HTTP without
 * touching the internet (see `docs/superpowers/plans/2026-09-20-phase-2-...`).
 * Nothing here is persisted: every process restart begins with zero
 * transactions, which is exactly what tests want.
 */
@Injectable()
export class FakeZibalStore {
  private transactions = new Map<string, FakeZibalTransaction>();
  private nextId = 1000;

  nextTrackId(): string {
    return String(this.nextId++);
  }

  create(tx: Omit<FakeZibalTransaction, 'createdAt'>): FakeZibalTransaction {
    const stored: FakeZibalTransaction = { ...tx, createdAt: new Date() };
    this.transactions.set(stored.trackId, stored);
    return stored;
  }

  find(trackId: string): FakeZibalTransaction | undefined {
    return this.transactions.get(trackId);
  }

  setScenario(trackId: string, scenario: FakeZibalScenario): boolean {
    const tx = this.transactions.get(trackId);
    if (!tx) {
      return false;
    }
    tx.scenario = scenario;
    return true;
  }

  markPaid(trackId: string, paid: boolean): FakeZibalTransaction | undefined {
    const tx = this.transactions.get(trackId);
    if (!tx) {
      return undefined;
    }
    tx.paid = paid;
    return tx;
  }

  markVerified(trackId: string): FakeZibalTransaction | undefined {
    const tx = this.transactions.get(trackId);
    if (!tx) {
      return undefined;
    }
    tx.verified = true;
    return tx;
  }

  recordCallbackAttempt(trackId: string): number {
    const tx = this.transactions.get(trackId);
    if (!tx) {
      return 0;
    }
    tx.verifyCount += 1;
    return tx.verifyCount;
  }

  reset(): void {
    this.transactions.clear();
    this.nextId = 1000;
  }
}
