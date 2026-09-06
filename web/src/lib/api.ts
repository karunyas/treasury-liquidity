import type { CurveResponse, LadderResponse, Order, OrderSide, QuoteResponse, HoldingsResponse } from "../types";

/** Surfaces the server's field-level validation messages to the form. */
export class ApiError extends Error {
  details: { field: string; message: string }[];
  code: string | null;
  body: Record<string, unknown> | null;

  constructor(
    message: string,
    details: { field: string; message: string }[] = [],
    code: string | null = null,
    body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.details = details;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      body?.error ?? `Request failed (${response.status})`,
      body?.details ?? [],
      body?.code ?? null,
      body ?? null,
    );
  }
  return body as T;
}

export const fetchCurve = () => request<CurveResponse>("/api/curve");

export const fetchQuote = (tenorKey: string, amountMinor: number) =>
  request<QuoteResponse>(
    `/api/orders/preview?tenorKey=${encodeURIComponent(tenorKey)}&amountMinor=${amountMinor}`,
  );

export const fetchOrders = (scope: "today" | "all") =>
  request<{ orders: Order[] }>(`/api/orders?scope=${scope}`);

export const submitOrder = (input: {
  idempotencyKey: string;
  side: OrderSide;
  tenorKey: string;
  amountMinor: number;
  expectedYieldBps: number;
}) => request<{ order: Order; replayed?: boolean }>("/api/orders", {
  method: "POST",
  body: JSON.stringify(input),
});

export const cancelOrder = (id: string) =>
  request<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });

export const fetchLadder = () => request<LadderResponse>("/api/orders/ladder");

export const fetchHoldings = () => request<HoldingsResponse>("/api/orders/holdings");
