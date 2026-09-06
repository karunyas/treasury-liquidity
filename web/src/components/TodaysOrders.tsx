import type { Order } from "../types";
import { formatMinor } from "../lib/format";
import { OrdersTable } from "./OrdersTable";

interface Props {
  orders: Order[];
  loading: boolean;
  onCancel: (id: string) => Promise<void>;
  onRepeat?: (order: Order) => void;
}

/** The "did it work" check, on the same screen as the ticket. */
export function TodaysOrders({ orders, loading, onCancel, onRepeat }: Props) {
  const open = orders.filter((o) => o.status === "SUBMITTED");
  const openNotional = open.reduce((sum, o) => sum + o.amountMinor, 0);

  return (
    <section className="card" id="todays-orders" aria-labelledby="today-heading">
      <div className="card-head">
        <h2 id="today-heading">Today's orders</h2>
        <span className="hint">
          {orders.length > 0 && (
            <>
              {open.length} open · {formatMinor(openNotional)} ·{" "}
            </>
          )}
          <a href="#/orders">View all orders →</a>
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="empty">
          {loading ? "Loading…" : "Place an order above and it will appear here."}
        </p>
      ) : (
        <OrdersTable orders={orders} onCancel={onCancel} onRepeat={onRepeat} compact />
      )}
    </section>
  );
}
