"use client";

import { Button, Dialog } from "@lastro/ui";
import { useRef, useState } from "react";
import type { ApiClient, FinancialResource } from "../lib/api";

export function SettleDialog({
  client,
  bookId,
  expense,
  payments,
  onClose,
  onSettled,
}: {
  client: ApiClient;
  bookId: string;
  expense: { id: string; amountMinor: string; currency: string };
  payments: FinancialResource[];
  onClose: () => void;
  onSettled: (message: string) => void;
}) {
  const [paymentId, setPaymentId] = useState("");
  const [amountMinor, setAmountMinor] = useState(expense.amountMinor);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await client.createExpenseSettlement(bookId, {
        expenseId: expense.id,
        paymentId,
        amountMinor,
        currency: expense.currency,
      });
      onSettled(`Settled expense ${expense.id} with payment ${paymentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Settle expense ${expense.id}`}
      initialFocusRef={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            Settle
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        style={{ display: "grid", gap: "0.75rem" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>Payment</span>
          <select
            ref={firstField}
            aria-label="Payment"
            value={paymentId}
            onChange={(event) => setPaymentId(event.target.value)}
            required
          >
            <option value="">Select a payment</option>
            {payments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>
            Amount (minor units)
          </span>
          <input
            aria-label="Amount (minor units)"
            value={amountMinor}
            onChange={(event) => setAmountMinor(event.target.value)}
            inputMode="numeric"
            required
          />
        </label>
        {error ? (
          <p style={{ color: "var(--lastro-danger)", margin: 0 }}>{error}</p>
        ) : null}
      </form>
    </Dialog>
  );
}

export function VoidDialog({
  client,
  bookId,
  target,
  onClose,
  onVoided,
}: {
  client: ApiClient;
  bookId: string;
  target: { settlementId: string; impact: string };
  onClose: () => void;
  onVoided: (message: string) => void;
}) {
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      await client.voidExpenseSettlement(bookId, target.settlementId, {
        voidReason: voidReason || undefined,
      });
      onVoided(`Voided settlement ${target.settlementId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Void settlement"
      initialFocusRef={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={submitting}>
            Confirm void
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This will void settlement <strong>{target.settlementId}</strong>.
        Impact: {target.impact}. This action cannot be undone.
      </p>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>
          Reason (optional)
        </span>
        <input
          ref={firstField}
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
        />
      </label>
      {error ? (
        <p style={{ color: "var(--lastro-danger)", margin: 0 }}>{error}</p>
      ) : null}
    </Dialog>
  );
}
