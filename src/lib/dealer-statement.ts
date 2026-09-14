import { partyBalance } from "@/lib/accounting/engine";
import { roundMoney } from "@/lib/pricing";
import { proofRemaining } from "@/lib/proofs";
import { paymentAmountDue } from "@/lib/upi";
import type { LedgerEntry, Order, Party, Voucher } from "@/lib/types";

export type DealerStatementReceipt = {
  date: string;
  amount: number;
  number: string;
  linkedOrderId?: string;
};

export type DealerPartyStatement = {
  partyId: string;
  partyName: string;
  outstanding: number;
  receipts: DealerStatementReceipt[];
};

/** Books outstanding + last receipts for the dealer’s linked party. No voucher dump. */
export function dealerPartyStatement(
  input: {
    parties?: Party[];
    vouchers?: Voucher[];
    ledgerEntries?: LedgerEntry[];
  },
  userId: string,
  asOf?: string
): DealerPartyStatement | null {
  const party = (input.parties ?? []).find(
    (p) => p.linkedUserId === userId && p.type === "customer" && p.active !== false
  );
  if (!party) return null;
  const day = (asOf || new Date().toISOString()).slice(0, 10);
  const closing = partyBalance(party, input.ledgerEntries ?? [], day);
  const receipts = (input.vouchers ?? [])
    .filter(
      (v) =>
        !v.voided &&
        v.type === "receipt" &&
        v.partyId === party.id
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt || "").localeCompare(a.createdAt || "")
    )
    .slice(0, 5)
    .map((v) => ({
      date: v.date.slice(0, 10),
      amount: v.total,
      number: v.number,
      linkedOrderId: v.linkedOrderId,
    }));
  return {
    partyId: party.id,
    partyName: party.name,
    outstanding: Math.max(0, roundMoney(closing)),
    receipts,
  };
}

export function attachDealerStatement(
  parties: Party[],
  statement: DealerPartyStatement | null
): Party[] {
  if (!statement) {
    return parties.map((p) => ({
      ...p,
      statementOutstanding: undefined,
      statementReceipts: undefined,
    }));
  }
  return parties.map((p) =>
    p.id === statement.partyId
      ? {
          ...p,
          statementOutstanding: statement.outstanding,
          statementReceipts: statement.receipts,
        }
      : p
  );
}

export function dealerOpenBilledOrders(
  orders: Order[] | undefined,
  userId: string
): Order[] {
  return (orders ?? [])
    .filter((o) => {
      if (o.userId !== userId || o.status === "cancelled") return false;
      if (o.actualBillAmount == null) return false;
      const due = paymentAmountDue(o);
      return proofRemaining(o.paymentProof, due) > 0.05;
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
