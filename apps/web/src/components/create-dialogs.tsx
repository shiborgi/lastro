"use client";

import { Button, Dialog, Field } from "@lastro/ui";
import { useId, useRef, useState } from "react";
import type { ApiClient } from "../lib/api";

export function CreateExpenseDialog({
  client,
  bookId,
  onClose,
  onCreated,
}: {
  client: ApiClient;
  bookId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const uid = useId();

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await client.createExpense(bookId, {
        accountId,
        partyId,
        expenseCategoryId,
        amountMinor,
        currency,
      });
      onCreated(`Created expense ${result.expense.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New expense"
      initialFocusRef={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            Create
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
        <Field label="Account id" htmlFor={`${uid}-account-id`}>
          <input
            ref={firstField}
            id={`${uid}-account-id`}
            aria-label="Account id"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            required
          />
        </Field>
        <Field label="Party id" htmlFor={`${uid}-party-id`}>
          <input
            id={`${uid}-party-id`}
            aria-label="Party id"
            value={partyId}
            onChange={(event) => setPartyId(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Expense category id"
          htmlFor={`${uid}-expense-category-id`}
        >
          <input
            id={`${uid}-expense-category-id`}
            aria-label="Expense category id"
            value={expenseCategoryId}
            onChange={(event) => setExpenseCategoryId(event.target.value)}
            required
          />
        </Field>
        <Field label="Amount (minor units)" htmlFor={`${uid}-amount-minor`}>
          <input
            id={`${uid}-amount-minor`}
            aria-label="Amount (minor units)"
            value={amountMinor}
            onChange={(event) => setAmountMinor(event.target.value)}
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Currency" htmlFor={`${uid}-currency`}>
          <input
            id={`${uid}-currency`}
            aria-label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </Field>
        {error ? (
          <p role="alert" style={{ color: "var(--lastro-danger)", margin: 0 }}>
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

export function CreatePaymentDialog({
  client,
  bookId,
  onClose,
  onCreated,
}: {
  client: ApiClient;
  bookId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const uid = useId();

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await client.createPayment(bookId, {
        accountId,
        amountMinor,
        currency,
      });
      onCreated(`Created payment ${result.payment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New payment"
      initialFocusRef={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            Create
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
        <Field label="Account id" htmlFor={`${uid}-account-id`}>
          <input
            ref={firstField}
            id={`${uid}-account-id`}
            aria-label="Account id"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            required
          />
        </Field>
        <Field label="Amount (minor units)" htmlFor={`${uid}-amount-minor`}>
          <input
            id={`${uid}-amount-minor`}
            aria-label="Amount (minor units)"
            value={amountMinor}
            onChange={(event) => setAmountMinor(event.target.value)}
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Currency" htmlFor={`${uid}-currency`}>
          <input
            id={`${uid}-currency`}
            aria-label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </Field>
        {error ? (
          <p role="alert" style={{ color: "var(--lastro-danger)", margin: 0 }}>
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
