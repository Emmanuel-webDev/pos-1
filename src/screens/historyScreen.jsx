import { useEffect } from "react";
import {
  EXPLORER_URL,
  DEPLOY_BLOCK,
  POS_CONTRACT_ADDRESS,
  publicClient,
  PURCHASE_COMPLETED_EVENT,
  USDC_DECIMALS,
} from "../app";

import { getItemIcon } from "../utils/helpers";

const CHUNK_SIZE = 1800n;

export default function HistoryScreen({
  merchantAddress,
  salesHistory,
  setSalesHistory,
  showToast,
}) {
  // ─────────────────────────────────────────────
  // Fetch merchant tx history safely in chunks
  // ─────────────────────────────────────────────
  async function fetchChainHistory() {
    if (!merchantAddress) return;

    try {
      const latestBlock = await publicClient.getBlockNumber();

      let fromBlock = DEPLOY_BLOCK;

      let allLogs = [];

      while (fromBlock <= latestBlock) {
        const toBlock =
          fromBlock + CHUNK_SIZE > latestBlock
            ? latestBlock
            : fromBlock + CHUNK_SIZE;

        const logs = await publicClient.getContractEvents({
          address: POS_CONTRACT_ADDRESS,

          abi: [PURCHASE_COMPLETED_EVENT],

          eventName: "PurchaseCompleted",

          args: {
            merchant: merchantAddress,
          },

          fromBlock,
          toBlock,
        });

        allLogs.push(...logs);

        fromBlock = toBlock + 1n;
      }

      // newest first
      const sortedLogs = [...allLogs].sort(
        (a, b) => Number(b.blockNumber) - Number(a.blockNumber),
      );

      const formattedSales = sortedLogs.map((log) => {
        const timestamp = Number(log.args.timestamp || 0) * 1000;

        const prices = log.args.prices || [];
        const items = log.args.items || [];

        return {
          id: log.transactionHash,

          txHash: log.transactionHash,

          blockNumber: Number(log.blockNumber),

          buyer: log.args.customer,

          merchant: log.args.merchant,

          amount: Number(log.args.totalAmount) / 10 ** USDC_DECIMALS,

          timestamp,

          date: new Date(timestamp),

          items: items.map((name, i) => ({
            name,

            price: Number(prices[i] || 0n) / 10 ** USDC_DECIMALS,
          })),
        };
      });

      setSalesHistory(formattedSales);
    } catch (err) {
      console.error("History fetch error:", err);

      showToast("Failed to load transaction history", "error");
    }
  }

  // ─────────────────────────────────────────────
  // Poll every 10 seconds
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!merchantAddress) return;

    fetchChainHistory();

    const interval = setInterval(() => {
      fetchChainHistory();
    }, 10000);

    return () => clearInterval(interval);
  }, [merchantAddress]);

  // ─────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────
  const todayStart = new Date();

  todayStart.setHours(0, 0, 0, 0);

  const todaySales = salesHistory.filter((s) => s.date >= todayStart);

  const todayTotal = todaySales.reduce((sum, s) => sum + s.amount, 0);

  const avgOrder = todaySales.length > 0 ? todayTotal / todaySales.length : 0;

  const shortMerchant = merchantAddress
    ? merchantAddress.slice(0, 6) + "…" + merchantAddress.slice(-4)
    : "—";

  // ─────────────────────────────────────────────
  // Group transactions by day
  // ─────────────────────────────────────────────
  const groupedSales = salesHistory.reduce((groups, sale) => {
    const date = sale.date;

    const key = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).toISOString();

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(sale);

    return groups;
  }, {});

  // newest days first
  const groupedEntries = Object.entries(groupedSales).sort(
    ([a], [b]) => new Date(b) - new Date(a),
  );

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
            style={{
              background: merchantAddress ? "var(--success)" : "#ccc",
            }}
          />
        </div>
      </header>

      <div className="screen__body">
        {/* Summary */}
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

        {/* Empty states */}
        {!merchantAddress && (
          <div className="empty-state">
            <div className="empty-state__icon">🔗</div>

            <div className="empty-state__title">Wallet not connected</div>

            <div className="empty-state__sub">Connect merchant wallet</div>
          </div>
        )}

        {merchantAddress && salesHistory.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">📭</div>

            <div className="empty-state__title">No sales yet</div>

            <div className="empty-state__sub">
              Transactions will appear here
            </div>
          </div>
        )}

        {/* Transaction list */}
        <div className="history-list">
          {groupedEntries.map(([dayKey, sales]) => {
            const sectionDate = new Date(dayKey);

            const today = new Date();

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const isToday = sectionDate.toDateString() === today.toDateString();

            const isYesterday =
              sectionDate.toDateString() === yesterday.toDateString();

            const sectionTitle = isToday
              ? "Today"
              : isYesterday
                ? "Yesterday"
                : sectionDate.toLocaleDateString([], {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  });

            const dailyTotal = sales.reduce(
              (sum, sale) => sum + sale.amount,
              0,
            );

            return (
              <div key={dayKey} className="history-section">
                {/* Section Header */}
                <div className="history-section__header">
                  <div className="history-section__title">{sectionTitle}</div>

                  <div className="history-section__total">
                    ${dailyTotal.toFixed(2)} USDC
                  </div>
                </div>

                {/* Transactions */}
                {sales.map((sale, idx) => {
                  const date = sale.date;

                  const timeStr = date.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  const itemNames =
                    sale.items?.map((i) => i.name).join(", ") || "Sale";

                  const icon = sale.items?.[0]
                    ? getItemIcon(sale.items[0].name)
                    : "🛍️";

                  const shortHash = sale.txHash
                    ? sale.txHash.slice(0, 10) + "…" + sale.txHash.slice(-6)
                    : "—";

                  return (
                    <div
                      key={sale.id}
                      className="history-row"
                      style={{
                        animationDelay: `${idx * 0.04}s`,
                      }}
                      onClick={() => {
                        window.open(
                          `${EXPLORER_URL}/tx/${sale.txHash}`,
                          "_blank",
                        );
                      }}
                    >
                      <div className="history-row__icon">{icon}</div>

                      <div className="history-row__info">
                        <div className="history-row__items">{itemNames}</div>

                        <div className="history-row__time">{timeStr}</div>

                        <div className="history-row__hash">{shortHash}</div>
                      </div>

                      <div className="history-row__right">
                        <div className="history-row__amount">
                          ${sale.amount.toFixed(2)}
                        </div>

                        <div className="badge-verified">✓ Base</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ height: 20 }} />
      </div>
    </>
  );
}
