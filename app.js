/* ═══════════════════════════════════════════════════════════════
   Base_P.OS · src/app.js  (MERCHANT SCREEN)
   Merchant connects wallet → builds basket → generates QR URL
   QR opens /pay.html on customer phone → customer pays
   Merchant screen polls chain → detects payment → success
   ═══════════════════════════════════════════════════════════════ */

import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia } from "@reown/appkit/networks";
import { getAccount, watchAccount } from "@wagmi/core";
import { createPublicClient, http } from "viem";
import QRCode from "qrcode";

// ─── Config ───────────────────────────────────────────────────────────────────

const WC_PROJECT_ID = "a34afecf807cf78abf13bc7a69b59797";
const EXPLORER_URL = "https://sepolia.basescan.org";
const USDC_DECIMALS = 6;
const POS_CONTRACT_ADDRESS = "0x750197d1cEb44ed1b6F1A1a91e3BE33aF80C168E";
const DEPLOY_BLOCK = 41486417n;

// ─── ABI ──────────────────────────────────────────────────────────────────────

const PURCHASE_COMPLETED_EVENT = {
  type: "event",
  name: "PurchaseCompleted",
  inputs: [
    { type: "address", name: "merchant", indexed: true },
    { type: "address", name: "customer", indexed: true },
    { type: "uint256", name: "totalAmount", indexed: false },
    { type: "string[]", name: "items", indexed: false },
    { type: "uint256[]", name: "prices", indexed: false },
    { type: "uint256", name: "timestamp", indexed: false },
    { type: "bool", name: "isUSDC", indexed: false },
  ],
};

// ─── AppKit (merchant wallet) ─────────────────────────────────────────────────

const wagmiAdapter = new WagmiAdapter({
  projectId: WC_PROJECT_ID,
  networks: [baseSepolia],
});

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId: WC_PROJECT_ID,
  networks: [baseSepolia],
  defaultNetwork: baseSepolia,
  metadata: {
    name: "Base POS",
    description: "Merchant wallet connection",
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  },
  features: { analytics: false, email: false, socials: false },
  themeMode: "light",
});

// ─── Viem public client ───────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// ─── State ────────────────────────────────────────────────────────────────────

let merchantAddress = null;
let basket = [];
let invoiceTotal = 0;
let invoiceStartTime = null;
let invoiceTimerRef = null;
let pollRef = null;
let salesHistory = [];
let currentScreen = "basket";

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const screens = {
  basket: $("screen-basket"),
  invoice: $("screen-invoice"),
  success: $("screen-success"),
  history: $("screen-history"),
};

// ─── Navigation ───────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  currentScreen = name;
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  if (name === "history") loadHistory();
}

// ─── Merchant Wallet ──────────────────────────────────────────────────────────

watchAccount(wagmiAdapter.wagmiConfig, {
  onChange(account) {
    merchantAddress = account.isConnected ? account.address : null;
    updateMerchantUI();
  },
});

function updateMerchantUI() {
  const connected = !!merchantAddress;
  const label = connected ? shortAddress(merchantAddress) : "Connect Wallet";
  const wl = $("wallet-label");
  if (wl) wl.textContent = label;
  const dot = $("wallet-dot");
  if (dot) dot.style.background = connected ? "var(--success)" : "#ccc";
  ["invoice-wallet-label", "history-wallet-label"].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = connected ? label : "—";
  });
}

// ─── Basket ───────────────────────────────────────────────────────────────────

function getItemIcon(name) {
  const n = name.toLowerCase();
  if (
    n.includes("coffee") ||
    n.includes("latte") ||
    n.includes("espresso") ||
    n.includes("cappuccino")
  )
    return "☕";
  if (n.includes("tea")) return "🍵";
  if (n.includes("juice") || n.includes("smoothie")) return "🧃";
  if (n.includes("water") || n.includes("drink")) return "💧";
  if (n.includes("cake") || n.includes("pastry") || n.includes("croissant"))
    return "🥐";
  if (n.includes("sandwich") || n.includes("burger")) return "🥪";
  if (n.includes("pizza")) return "🍕";
  if (n.includes("salad")) return "🥗";
  if (n.includes("beer") || n.includes("wine")) return "🍷";
  return "🛍️";
}

function addItem() {
  const nameEl = $("item-name"),
    priceEl = $("item-price");
  const name = nameEl.value.trim(),
    price = parseFloat(priceEl.value);
  if (!name || isNaN(price) || price <= 0) return;
  basket.push({
    id: Date.now() + Math.random(),
    name,
    price: Math.round(price * 100) / 100,
    icon: getItemIcon(name),
  });
  renderBasket();
  nameEl.value = "";
  priceEl.value = "";
  $("btn-add-item").disabled = true;
  nameEl.focus();
}

function removeItem(id) {
  basket = basket.filter((i) => i.id !== id);
  renderBasket();
}
function getTotal() {
  return basket.reduce((s, i) => s + i.price, 0);
}

function renderBasket() {
  const total = getTotal();
  const list = $("basket-list");
  const empty = $("basket-empty");
  const label = $("basket-label");
  const footer = $("checkout-footer");

  $("basket-count").textContent = basket.length;
  $("basket-plural").textContent = basket.length !== 1 ? "s" : "";
  $("basket-total").textContent = total.toFixed(2);
  $("checkout-total-label").textContent = total.toFixed(2);

  if (basket.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    label.style.display = "none";
    footer.style.display = "none";
    return;
  }
  empty.style.display = "none";
  label.style.display = "block";
  footer.style.display = "block";

  list.innerHTML = basket
    .map(
      (item) => `
    <div class="basket-item">
      <div class="basket-item__icon">${item.icon}</div>
      <div class="basket-item__info">
        <div class="basket-item__name">${escapeHtml(item.name)}</div>
        <div class="basket-item__meta">USDC · Base Sepolia</div>
      </div>
      <div class="basket-item__price">$${item.price.toFixed(2)}</div>
      <button class="basket-item__remove" data-id="${item.id}" aria-label="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E53E3E" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`,
    )
    .join("");

  list
    .querySelectorAll(".basket-item__remove")
    .forEach((btn) =>
      btn.addEventListener("click", () => removeItem(Number(btn.dataset.id))),
    );
}

// ─── Checkout — Generate QR ───────────────────────────────────────────────────

async function startCheckout() {
  if (basket.length === 0) return;
  if (!merchantAddress) {
    showToast("Connect merchant wallet first.", "error");
    return;
  }

  invoiceTotal = getTotal();

  // Pack invoice data into base64 query param
  const invoiceData = {
    merchant: merchantAddress,
    total: invoiceTotal.toFixed(6),
    items: basket.map((i) => ({ name: i.name, price: i.price })),
    nonce: Date.now(),
  };
  const encoded = btoa(JSON.stringify(invoiceData));
  const payURL = `${window.location.origin}/pay.html?invoice=${encoded}`;

  // Update UI
  $("invoice-amount-value").textContent = invoiceTotal.toFixed(2);
  $("invoice-pills").innerHTML = basket
    .map(
      (i) =>
        `<div class="invoice-pill">${escapeHtml(i.name)} · $${i.price.toFixed(2)}</div>`,
    )
    .join("");

  // Render QR
  const canvas = $("qr-canvas");
  await QRCode.toCanvas(canvas, payURL, {
    width: 240,
    margin: 1,
    color: { dark: "#1B365F", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });

  // Start elapsed timer
  invoiceStartTime = Date.now();
  clearInterval(invoiceTimerRef);
  invoiceTimerRef = setInterval(updateElapsed, 1000);

  // Poll chain for PurchaseCompleted
  startPaymentPoll(invoiceData.nonce);

  showScreen("invoice");
}

// ─── Poll chain ───────────────────────────────────────────────────────────────

async function startPaymentPoll(nonce) {
  stopPaymentPoll();
  // We only want events that happened after this invoice was created
  const invoiceTs = BigInt(Math.floor(nonce / 1000));

  try {
    let fromBlock = await publicClient.getBlockNumber();

    pollRef = setInterval(async () => {
      if (currentScreen !== "invoice") {
        stopPaymentPoll();
        return;
      }
      try {
        const toBlock = await publicClient.getBlockNumber();
        if (toBlock < fromBlock) return;

        const logs = await publicClient.getContractEvents({
          address: POS_CONTRACT_ADDRESS,
          abi: [PURCHASE_COMPLETED_EVENT],
          eventName: "PurchaseCompleted",
          args: { merchant: merchantAddress },
          fromBlock,
          toBlock,
        });

        const match = logs.find(
          (l) => BigInt(l.args.timestamp || 0n) >= invoiceTs,
        );
        if (match) {
          stopPaymentPoll();
          handlePaymentConfirmed(match);
        }

        fromBlock = toBlock + 1n;
      } catch (err) {
        console.warn("Poll error:", err.message);
      }
    }, 3000);
  } catch (err) {
    console.error("Poll start failed:", err);
  }
}

function stopPaymentPoll() {
  if (pollRef) {
    clearInterval(pollRef);
    pollRef = null;
  }
  clearInterval(invoiceTimerRef);
}

// ─── Payment confirmed ────────────────────────────────────────────────────────

function handlePaymentConfirmed(log) {
  stopPaymentPoll();
  const { args, transactionHash, blockNumber } = log;
  const amount = Number(args.totalAmount) / Math.pow(10, USDC_DECIMALS);
  const itemNames = args.items || [];
  const prices = args.prices || [];
  const customer = args.customer || "—";
  const txHash = transactionHash || "—";
  const block = blockNumber ? blockNumber.toString() : "—";

  $("success-amount").textContent = amount.toFixed(2);
  $("success-items").textContent = itemNames.join(", ");
  $("eas-hash").textContent =
    txHash !== "—" ? txHash.slice(0, 10) + "…" + txHash.slice(-6) : "—";
  $("eas-block").textContent = block;
  $("eas-from").textContent =
    customer !== "—" ? customer.slice(0, 6) + "…" + customer.slice(-4) : "—";
  $("btn-view-receipt").onclick = () => {
    if (txHash && txHash !== "—")
      window.open(`${EXPLORER_URL}/tx/${txHash}`, "_blank");
  };

  salesHistory.unshift({
    id: txHash,
    txHash,
    block,
    buyer: customer,
    amount,
    items: itemNames.map((name, i) => ({
      name,
      price: Number(prices[i] || 0n) / Math.pow(10, USDC_DECIMALS),
    })),
    timestamp: args.timestamp
      ? new Date(Number(args.timestamp) * 1000)
      : new Date(),
  });

  basket = [];
  renderBasket();
  showScreen("success");
  spawnConfetti();
}

// ─── History ──────────────────────────────────────────────────────────────────

function loadHistory() {
  renderHistory();
  if (!merchantAddress) {
    $("history-list").innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🔗</div>
        <div class="empty-state__title">Wallet not connected</div>
        <div class="empty-state__sub">Connect your merchant wallet to load history</div>
      </div>`;
    return;
  }
  fetchChainHistory().catch((err) => {
    console.error(err);
    showToast("Could not load history.", "error");
  });
}

async function fetchChainHistory() {
  const list = $("history-list");
  if (list && salesHistory.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">⛓️</div>
        <div class="empty-state__title">Loading from Base…</div>
        <div class="empty-state__sub">Scanning all transaction logs</div>
      </div>`;
  }

  const logs = await publicClient.getContractEvents({
    address: POS_CONTRACT_ADDRESS,
    abi: [PURCHASE_COMPLETED_EVENT],
    eventName: "PurchaseCompleted",
    args: { merchant: merchantAddress },
    fromBlock: DEPLOY_BLOCK,
    toBlock: "latest",
  });

  salesHistory = [...logs].reverse().map((log) => ({
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

  renderHistory();
}

function getDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatDayLabel(dayKey) {
  const d = new Date(dayKey + "T12:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === yest.getTime()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function renderHistory() {
  const list = $("history-list");
  if (!list) return;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySales = salesHistory.filter(
    (s) => new Date(s.timestamp) >= todayStart,
  );
  const todayTotal = todaySales.reduce((s, x) => s + x.amount, 0);
  const avg = todaySales.length ? todayTotal / todaySales.length : 0;
  $("history-today-total").textContent = "$" + todayTotal.toFixed(2);
  $("history-tx-count").textContent = todaySales.length;
  $("history-avg").textContent = "$" + avg.toFixed(2);

  if (salesHistory.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📭</div>
        <div class="empty-state__title">No sales yet</div>
        <div class="empty-state__sub">Completed transactions will appear here</div>
      </div>`;
    return;
  }

  // Group by day
  const groups = {},
    order = [];
  for (const sale of salesHistory) {
    const key = getDayKey(new Date(sale.timestamp));
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(sale);
  }

  list.innerHTML = order
    .map((dayKey) => {
      const daySales = groups[dayKey];
      const dayLabel = formatDayLabel(dayKey);
      const dayTotal = daySales.reduce((s, x) => s + x.amount, 0);
      const txWord = daySales.length === 1 ? "transaction" : "transactions";

      const rows = daySales
        .map((sale) => {
          const time = new Date(sale.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const names = sale.items?.map((i) => i.name).join(", ") || "Sale";
          const icon = sale.items?.[0] ? getItemIcon(sale.items[0].name) : "🛍️";
          const hash = sale.txHash
            ? sale.txHash.slice(0, 10) + "…" + sale.txHash.slice(-6)
            : "—";
          return `
        <div class="history-row" data-hash="${sale.txHash}">
          <div class="history-row__icon">${icon}</div>
          <div class="history-row__info">
            <div class="history-row__items">${escapeHtml(names)}</div>
            <div class="history-row__time">${time}</div>
            <div class="history-row__hash">${hash}</div>
          </div>
          <div class="history-row__right">
            <div class="history-row__amount">$${sale.amount.toFixed(2)}</div>
            <div class="badge-verified">✓ Base</div>
          </div>
        </div>`;
        })
        .join("");

      return `
      <div class="history-day-group">
        <div class="history-day-header">
          <div class="history-day-header__left">
            <div class="history-day-header__label">${dayLabel}</div>
            <div class="history-day-header__count">${daySales.length} ${txWord}</div>
          </div>
          <div class="history-day-header__total">$${dayTotal.toFixed(2)} USDC</div>
        </div>
        <div class="history-day-rows">${rows}</div>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".history-row").forEach((row) => {
    row.addEventListener("click", () => {
      const hash = row.dataset.hash;
      const hashEl = row.querySelector(".history-row__hash");
      const open = hashEl.classList.toggle("open");
      if (!open && hash && hash !== "—")
        window.open(`${EXPLORER_URL}/tx/${hash}`, "_blank");
    });
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function updateElapsed() {
  const el = $("invoice-elapsed");
  if (!el || !invoiceStartTime) return;
  const s = Math.floor((Date.now() - invoiceStartTime) / 1000);
  el.textContent =
    s < 60 ? `${s}s elapsed` : `${Math.floor(s / 60)}m ${s % 60}s elapsed`;
}

function shortAddress(a) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function spawnConfetti() {
  const c = $("confetti-container");
  if (!c) return;
  c.innerHTML = "";
  const colors = [
    "#0052FF",
    "#7B61FF",
    "#00C853",
    "#FFD700",
    "#FF6B6B",
    "#2775CA",
  ];
  for (let i = 0; i < 55; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.cssText = `left:${Math.random() * 100}%;width:${Math.random() * 8 + 5}px;height:${Math.random() * 8 + 5}px;background:${colors[Math.floor(Math.random() * colors.length)]};animation-delay:${Math.random() * 0.6}s;animation-duration:${Math.random() * 0.8 + 1.4}s;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};`;
    c.appendChild(p);
  }
  setTimeout(() => {
    c.innerHTML = "";
  }, 3000);
}

function showToast(msg, type = "info") {
  const ex = document.querySelector(".toast");
  if (ex) ex.remove();
  const t = document.createElement("div");
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  document.querySelector(".app-shell").appendChild(t);
  requestAnimationFrame(() => t.classList.add("toast--visible"));
  setTimeout(() => {
    t.classList.remove("toast--visible");
    setTimeout(() => t.remove(), 320);
  }, 2800);
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────

function wireEvents() {
  $("btn-wallet").addEventListener("click", () =>
    appKit.open({ view: "Connect" }),
  );

  const nameEl = $("item-name"),
    priceEl = $("item-price"),
    addBtn = $("btn-add-item");
  const validate = () => {
    const n = nameEl.value.trim(),
      p = parseFloat(priceEl.value);
    addBtn.disabled = !(n.length > 0 && !isNaN(p) && p > 0);
  };
  nameEl.addEventListener("input", validate);
  priceEl.addEventListener("input", validate);
  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      priceEl.focus();
      e.preventDefault();
    }
  });
  priceEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !addBtn.disabled) {
      addItem();
      e.preventDefault();
    }
  });
  addBtn.addEventListener("click", addItem);
  $("btn-checkout").addEventListener("click", startCheckout);
  $("btn-back-invoice").addEventListener("click", () => {
    stopPaymentPoll();
    showScreen("basket");
  });
  $("btn-new-sale").addEventListener("click", () => showScreen("basket"));
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const t = tab.dataset.tab;
      if (t === "basket" || t === "history") showScreen(t);
    });
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  renderBasket();
  const account = getAccount(wagmiAdapter.wagmiConfig);
  if (account.isConnected && account.address) merchantAddress = account.address;
  updateMerchantUI();
});

