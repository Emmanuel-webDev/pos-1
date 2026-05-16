import { useEffect, useRef, useState, useCallback } from "react";
import { useModal } from "connectkit";
import { useConfig } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import {
  USDC_ADDRESS,
  USDC_DECIMALS,
  POS_CONTRACT_ADDRESS,
  MAX_UINT256,
  publicClient,
  PURCHASE_COMPLETED_EVENT,
} from "../app";

const POS_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_merchant", type: "address" },
      { internalType: "string[]", name: "_items", type: "string[]" },
      { internalType: "uint256[]", name: "_prices", type: "uint256[]" },
    ],
    name: "checkoutUSDC",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

export default function InvoiceScreen({
  basket,
  merchantAddress,
  customerAddress,
  customerAddressRef,
  checkoutPhase,
  setCheckoutPhase,
  waitingText,
  setWaitingText,
  showToast,
  startCheckoutMode,
  endCheckoutMode,
  disconnect,
  onSuccess,
  onBack,
}) {
  const { setOpen } = useModal();
  const config = useConfig();

  const [elapsed, setElapsed] = useState(0);
  const [paymentFlowStarted, setPaymentFlowStarted] = useState(false);

  const startTimeRef = useRef(null);
  const elapsedRef = useRef(null);
  const pollRef = useRef(null);
  const customerRef = useRef(null); // local mirror to avoid stale closures
  const flowRunningRef = useRef(false);

  const invoiceTotal = basket.reduce((s, i) => s + i.price, 0);

  // ── Open ConnectKit QR immediately on mount ───────────────────────────────
  useEffect(() => {
    startTimeRef.current = Date.now();
    setElapsed(0);
    setCheckoutPhase("connect");
    setWaitingText("Customer: scan QR with wallet app");
    setPaymentFlowStarted(false);
    flowRunningRef.current = false;

    // Open ConnectKit straight to QR code view
    // Small delay lets the screen render first
    const t = setTimeout(() => {
      setOpen(true);
    }, 400);

    // Elapsed timer
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => {
      clearTimeout(t);
      clearInterval(elapsedRef.current);
      clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watch for customer wallet connecting ──────────────────────────────────
  useEffect(() => {
    if (!customerAddress) return;
    if (flowRunningRef.current) return;

    // Prevent merchant reusing own wallet
    if (
      merchantAddress &&
      customerAddress.toLowerCase() === merchantAddress.toLowerCase()
    ) {
      showToast("Use a different wallet for the customer.", "error");
      return;
    }

    customerRef.current = customerAddress;
    setOpen(false);
    flowRunningRef.current = true;
    setPaymentFlowStarted(true);
    runPaymentFlow();
  }, [customerAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Payment flow ──────────────────────────────────────────────────────────
  async function runPaymentFlow() {
    const customer = customerRef.current;
    if (!customer) return;

    setWaitingText(`Customer connected · ${customer.slice(0, 6)}…${customer.slice(-4)}`);
    setCheckoutPhase("approve");
    showToast("Customer wallet connected!", "success");

    await sleep(800);

    try {
      const itemNames = basket.map((i) => i.name);
      const atomicPrices = basket.map((i) =>
        BigInt(Math.round(i.price * Math.pow(10, USDC_DECIMALS)))
      );
      const atomicTotal = atomicPrices.reduce((a, b) => a + b, 0n);

      // ── Step 1: Check allowance ───────────────────────────────────────
      setWaitingText("Checking USDC allowance…");

      const allowance = await readContract(config, {
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "allowance",
        args: [customer, POS_CONTRACT_ADDRESS],
      });

      // ── Step 2: Approve if needed ─────────────────────────────────────
      if (BigInt(allowance) < atomicTotal) {
        setCheckoutPhase("approve");
        setWaitingText("Approve USDC spending on customer phone…");
        showToast("Requesting USDC approval on customer wallet…", "info");

        const approveTx = await writeContract(config, {
          address: USDC_ADDRESS,
          abi: USDC_ABI,
          functionName: "approve",
          args: [POS_CONTRACT_ADDRESS, MAX_UINT256],
        });

        setWaitingText("Approval sent · waiting for confirmation…");
        await waitForTransactionReceipt(config, { hash: approveTx });
        showToast("USDC approved ✓", "success");
      }

      // ── Step 3: checkoutUSDC ──────────────────────────────────────────
      setCheckoutPhase("pay");
      setWaitingText("Payment request sent to customer phone…");
      showToast("Confirm payment on customer wallet…", "info");

      const checkoutTx = await writeContract(config, {
        address: POS_CONTRACT_ADDRESS,
        abi: POS_ABI,
        functionName: "checkoutUSDC",
        args: [merchantAddress, itemNames, atomicPrices],
      });

      setWaitingText("Transaction sent · confirming on chain…");

      const receipt = await waitForTransactionReceipt(config, {
        hash: checkoutTx,
      });

      // ── Step 4: Build sale object & succeed ───────────────────────────
      if (receipt.status === "success") {
        const sale = {
          id: receipt.transactionHash,
          txHash: receipt.transactionHash,
          block: receipt.blockNumber?.toString() || "—",
          buyer: customer,
          amount: invoiceTotal,
          items: basket.map((i) => ({ name: i.name, price: i.price })),
          timestamp: new Date(),
        };

        clearInterval(elapsedRef.current);
        clearInterval(pollRef.current);

        // Disconnect customer, restore merchant state
        try {
          await disconnect();
        } catch (_) {}

        onSuccess(sale);
      } else {
        throw new Error("Transaction reverted");
      }
    } catch (err) {
      console.error(err);
      flowRunningRef.current = false;
      setPaymentFlowStarted(false);
      showToast(err.shortMessage || err.message || "Payment failed", "error");
      setWaitingText("Payment failed — try again");
    }
  }

  // ── Demo simulate ─────────────────────────────────────────────────────────
  function simulatePayment() {
    const fakeTx = "0xdemo" + Math.random().toString(16).slice(2, 14);
    const sale = {
      id: fakeTx,
      txHash: fakeTx,
      block: "demo",
      buyer: "0xDEMO0000000000000000000000000000DEMO0001",
      amount: invoiceTotal,
      items: basket.map((i) => ({ name: i.name, price: i.price })),
      timestamp: new Date(),
    };
    clearInterval(elapsedRef.current);
    clearInterval(pollRef.current);
    endCheckoutMode();
    onSuccess(sale);
  }

  // ── Elapsed format ────────────────────────────────────────────────────────
  const elapsedStr =
    elapsed < 60
      ? `${elapsed}s elapsed`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`;

  const shortMerchant = merchantAddress
    ? merchantAddress.slice(0, 6) + "…" + merchantAddress.slice(-4)
    : "—";

  return (
    <>
      <header className="top-bar">
        <div className="top-bar__left">
          <button
            className="back-btn"
            onClick={() => {
              clearInterval(elapsedRef.current);
              clearInterval(pollRef.current);
              onBack();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <div className="top-bar__title">Waiting for Customer</div>
            <div className="top-bar__sub">Scan to connect wallet</div>
          </div>
        </div>
        <div className="wallet-btn" style={{ pointerEvents: "none" }}>
          <div className="wallet-avatar" />
          <span>{shortMerchant}</span>
          <div className="wallet-dot" style={{ background: "var(--success)" }} />
        </div>
      </header>

      <div className="screen__body invoice-body">
        {/* Amount */}
        <div className="invoice-amount fade-up-1">
          <USDCIcon size={26} />
          <span className="invoice-amount__num">{invoiceTotal.toFixed(2)}</span>
          <span className="invoice-amount__unit">USDC</span>
        </div>

        {/* Item pills */}
        <div className="invoice-pills fade-up-2">
          {basket.map((item) => (
            <div key={item.id} className="invoice-pill">
              {item.name} · ${item.price.toFixed(2)}
            </div>
          ))}
        </div>

        {/* ConnectKit CTA area */}
        <div className="qr-wrap fade-up-3">
          <div className="qr-glow" />
          <div className="glass-card qr-card">
            <div className="connectkit-cta">
              {!paymentFlowStarted ? (
                <>
                  <div className="connectkit-cta__icon">📱</div>
                  <div className="connectkit-cta__text">
                    WalletConnect QR is open
                    <br />
                    <span>Customer scans with any wallet app</span>
                  </div>
                  <button
                    className="btn-secondary connectkit-reopen"
                    onClick={() => setOpen(true)}
                  >
                    Re-open QR
                  </button>
                </>
              ) : (
                <>
                  <div className="connectkit-cta__icon">⚡</div>
                  <div className="connectkit-cta__text">
                    Customer wallet connected
                    <br />
                    <span>Processing payment…</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Phase indicator */}
        <div className="phase-indicator fade-up-4">
          {["connect", "approve", "pay"].map((phase, i, arr) => {
            const idx = arr.indexOf(checkoutPhase);
            const isActive = phase === checkoutPhase;
            const isDone = i < idx;
            return (
              <div key={phase} style={{ display: "flex", alignItems: "center" }}>
                <div
                  className={`phase-step ${isActive ? "phase-step--active" : ""} ${isDone ? "phase-step--done" : ""}`}
                >
                  <div className="phase-step__dot" />
                  <span>{phase.charAt(0).toUpperCase() + phase.slice(1)}</span>
                </div>
                {i < arr.length - 1 && <div className="phase-divider" />}
              </div>
            );
          })}
        </div>

        {/* Waiting dots */}
        <div className="waiting fade-up-4">
          <div className="dots">
            <div className="dot" />
            <div className="dot" />
            <div className="dot" />
          </div>
          <div className="waiting__text">{waitingText}</div>
          <div className="waiting__elapsed">{elapsedStr}</div>
        </div>

        <div className="gasless-note fade-up-5">
          <span>⚡</span> ConnectKit · WalletConnect QR · Base Sepolia
        </div>

        <button onClick={simulatePayment} className="demo-pay-btn fade-up-5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Simulate Payment (demo)
        </button>
      </div>
    </>
  );
}

function USDCIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M20.5 18.3c0-2.1-1.3-2.8-3.8-3.1-1.8-.2-2.2-.7-2.2-1.5s.6-1.3 1.8-1.3c1.1 0 1.7.4 2 1.3.1.2.2.3.4.3h.9c.3 0 .5-.2.5-.5v-.1c-.3-1.4-1.4-2.4-2.8-2.6V9.5c0-.3-.2-.5-.5-.6H16c-.3 0-.5.2-.5.6v1.3c-1.7.2-2.8 1.3-2.8 2.8 0 2 1.2 2.7 3.7 3 1.7.3 2.3.7 2.3 1.6s-.8 1.5-1.9 1.5c-1.5 0-2-.6-2.3-1.5-.1-.2-.2-.3-.4-.3h-.9c-.3 0-.5.2-.5.5v.1c.3 1.5 1.3 2.5 3 2.8v1.3c0 .3.2.5.5.6h.9c.3 0 .5-.2.5-.6v-1.3c1.8-.3 3-.1 3.4-2.8z" fill="white" />
    </svg>
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}