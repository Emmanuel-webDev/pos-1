import { useEffect } from "react";
import { EXPLORER_URL, DEPLOY_BLOCK, POS_CONTRACT_ADDRESS, publicClient, PURCHASE_COMPLETED_EVENT, USDC_DECIMALS } from "../App";
import { getItemIcon } from "../utils/helpers";

export default function HistoryScreen({
  merchantAddress,
  salesHistory,
  setSalesHistory,
  showToast,
}) {
  useEffect(() => {
    if (!merchantAddress) return;
    fetchChainHistory();
  }, [merchantAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchChainHistory() {
    try {
      const logs = await publicClient.getContractEvents({
        address: POS_CONTRACT_ADDRESS,
        abi: [PURCHASE_COMPLETED_EVENT],
        eventName: "PurchaseCompleted",
        args: { merchant: merchantAddress },
        fromBlock: DEPLOY_BLOCK,
        toBlock: "latest",
      });

      const fetched = [...logs].reverse().map((log) => ({
        id: log.transactionHash,
        txHash: log.transactionHash,
        block: log.blockNumber?.toString() || "—",
        buyer: log.args.customer,
        amount: Number(log.args.totalAmount) / Math.pow(10, USDC_DECIMALS),
        items: (log.args.items || []).map((name, i) => ({
          name,
          price: Number(log.args.prices?.[i] || 0n) / Math.pow(10, USDC_DECIMALS),
        })),
        timestamp: new Date(Number(log.args.timestamp) * 1000),
      }));

      setSalesHistory((prev) => {
        // Merge: chain logs + session-only (demo) entries, deduplicated
        const byId = new Map();
        [...fetched, ...prev].forEach((s) => byId.set(s.id, s));
        return Array.from(byId.values()).sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );
      });
    } catch (err) {
      console.error("History error:", err);
      showToast("Could not load history.", "error");
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySales = salesHistory.filter(
    (s) => new Date(s.timestamp) >= todayStart
  );
  const todayTotal = todaySales.reduce((sum, s) => sum + s.amount, 0);
  const avgOrder = todaySales.length ? todayTotal / todaySales.length : 0;

  const shortMerchant = merchantAddress
    ? merchantAddress.slice(0, 6) + "…" + merchantAddress.slice(-4)
    : "—";

  return (
    <>
      <header className="top-bar">
        <div className="top-bar__left">
          <div className="top-bar__logo">⬡</div>
          <div>
            <div className="top-bar__title">Sales History</div>
            <div className="top-bar__sub">All verified transactions</div>
          </div>
        </div>
        <div className="wallet-btn" style={{ pointerEvents: "none" }}>
          <div className="wallet-avatar" />
          <span>{shortMerchant}</span>
          <div
            className="wallet-dot"
            style={{ background: merchantAddress ? "var(--success)" : "#ccc" }}
          />
        </div>
      </header>

      <div className="screen__body">
        <div className="summary-card fade-up">
          <div className="summary-card__label">Today's Revenue</div>
          <div className="summary-card__amount">
            <span className="summary-card__num">${todayTotal.toFixed(2)}</span>
            <span className="summary-card__unit">USDC</span>
          </div>
          <div className="summary-card__stats">
            <div className="summary-stat">
              <div className="summary-stat__label">Transactions</div>
              <div className="summary-stat__value">{todaySales.length}</div>
            </div>
            <div className="summary-stat">
              <div className="summary-stat__label">Avg. Order</div>
              <div className="summary-stat__value">${avgOrder.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {!merchantAddress && (
          <div className="empty-state">
            <div className="empty-state__icon">🔗</div>
            <div className="empty-state__title">Wallet not connected</div>
            <div className="empty-state__sub">Connect your merchant wallet to load history</div>
          </div>
        )}

        {merchantAddress && salesHistory.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">📭</div>
            <div className="empty-state__title">No sales yet</div>
            <div className="empty-state__sub">Completed transactions will appear here</div>
          </div>
        )}

        <div className="history-list">
          {salesHistory.map((sale, idx) => {
            const date = new Date(sale.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
            const itemNames = sale.items?.map((i) => i.name).join(", ") || "Sale";
            const icon = sale.items?.[0] ? getItemIcon(sale.items[0].name) : "🛍️";
            const shortHash = sale.txHash
              ? sale.txHash.slice(0, 10) + "…" + sale.txHash.slice(-6)
              : "—";
            const isDemo = sale.txHash?.startsWith("0xdemo");

            return (
              <div
                key={sale.id}
                className="history-row"
                style={{ animationDelay: `${idx * 0.04}s` }}
                onClick={() => {
                  if (!isDemo && sale.txHash && sale.txHash !== "—") {
                    window.open(`${EXPLORER_URL}/tx/${sale.txHash}`, "_blank");
                  }
                }}
              >
                <div className="history-row__icon">{icon}</div>
                <div className="history-row__info">
                  <div className="history-row__items">{itemNames}</div>
                  <div className="history-row__time">{dateStr} · {timeStr}</div>
                  <div className="history-row__hash">{isDemo ? "demo tx" : shortHash}</div>
                </div>
                <div className="history-row__right">
                  <div className="history-row__amount">${sale.amount.toFixed(2)}</div>
                  <div className="badge-verified">{isDemo ? "demo" : "✓ Base"}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ height: 20 }} />
      </div>
    </>
  );
}