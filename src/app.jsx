import { useState, useRef, useEffect, useCallback } from "react";
import { useAccount, useDisconnect, useConnectors } from "wagmi";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import BasketScreen from "./screens/BasketScreen";
import InvoiceScreen from "./screens/InvoiceScreen";
import SuccessScreen from "./screens/SuccessScreen";
import HistoryScreen from "./screens/HistoryScreen";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";

export const EXPLORER_URL = "https://sepolia.basescan.org";
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;
export const POS_CONTRACT_ADDRESS = "0x750197d1cEb44ed1b6F1A1a91e3BE33aF80C168E";
export const DEPLOY_BLOCK = 41486417n;
export const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

export const PURCHASE_COMPLETED_EVENT = {
  type: "event",
  name: "PurchaseCompleted",
  inputs: [
    { type: "address", name: "merchant",    indexed: true  },
    { type: "address", name: "customer",    indexed: true  },
    { type: "uint256", name: "totalAmount", indexed: false },
    { type: "string[]",name: "items",       indexed: false },
    { type: "uint256[]",name:"prices",      indexed: false },
    { type: "uint256", name: "timestamp",   indexed: false },
    { type: "bool",    name: "isUSDC",      indexed: false },
  ],
};

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

export default function App() {
  const [screen, setScreen]               = useState("basket");
  const [basket, setBasket]               = useState([]);
  const [salesHistory, setSalesHistory]   = useState([]);
  const [lastSale, setLastSale]           = useState(null);
  const [toast, setToast]                 = useState(null);
  const [checkoutPhase, setCheckoutPhase] = useState("connect");
  const [waitingText, setWaitingText]     = useState("Waiting for customer…");

  // Merchant lives in plain React state — never cleared by wagmi
  const [merchantAddress, setMerchantAddress] = useState(null);

  const checkoutInProgressRef = useRef(false);
  const [customerAddress, setCustomerAddress] = useState(null);
  const customerAddressRef = useRef(null);

  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();

  // ── Hard-kill the WalletConnect session ──────────────────────────────────
  // Calls disconnect() on the connector object itself (kills the pairing on
  // the customer's phone) AND calls wagmi's disconnect to clear local state.
  const hardDisconnect = useCallback(async () => {
    try {
      // Kill every connector that's currently active (catches WC + injected)
      for (const c of connectors) {
        try { await c.disconnect(); } catch (_) {}
      }
      // Also kill the currently active one via wagmi
      if (connector) {
        try { await connector.disconnect(); } catch (_) {}
      }
    } catch (_) {}
    // wagmi state cleanup
    disconnect();
  }, [connector, connectors, disconnect]);

  // ── Route wagmi events ────────────────────────────────────────────────────
  useEffect(() => {
    if (checkoutInProgressRef.current) {
      if (isConnected && address) {
        customerAddressRef.current = address;
        setCustomerAddress(address);
      } else {
        // Customer disconnected from their own phone
        customerAddressRef.current = null;
        setCustomerAddress(null);
      }
    } else {
      if (isConnected && address) {
        setMerchantAddress(address);
      }
    }
  }, [address, isConnected]);

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type, id: Date.now() });
  }, []);

  // ── startCheckoutMode ─────────────────────────────────────────────────────
  // Merchant address already in state. Hard-kill any active session so
  // ConnectKit shows a brand-new QR for the customer.
  const startCheckoutMode = useCallback(async () => {
    checkoutInProgressRef.current = true;
    customerAddressRef.current = null;
    setCustomerAddress(null);
    await hardDisconnect();
  }, [hardDisconnect]);

  // ── endCheckoutMode ───────────────────────────────────────────────────────
  // Called after payment or Back. Hard-kills the customer's WC pairing so
  // next checkout starts completely fresh.
const hardResetWalletConnection = async () => {
  try {
    // disconnect wagmi
    await disconnect?.({ clearState: true });

    // remove wagmi persistence
    localStorage.removeItem("wagmi.store");

    // remove ALL walletconnect persistence
    Object.keys(localStorage).forEach((key) => {
      if (key.toLowerCase().includes("walletconnect")) {
        localStorage.removeItem(key);
      }
    });

    Object.keys(sessionStorage).forEach((key) => {
      if (key.toLowerCase().includes("walletconnect")) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (err) {
    console.error(err);
  }
};

  const addSaleToHistory = useCallback((sale) => {
    setSalesHistory((prev) => {
      if (prev.find((s) => s.id === sale.id)) return prev;
      return [sale, ...prev];
    });
  }, []);

  return (
    <div className="app-shell">
      <div className={`screen ${screen === "basket"  ? "active" : ""}`} id="screen-basket">
        <BasketScreen
          basket={basket}
          setBasket={setBasket}
          merchantAddress={merchantAddress}
          showToast={showToast}
          onCheckout={() => setScreen("invoice")}
          startCheckoutMode={startCheckoutMode}
        />
      </div>

      <div className={`screen ${screen === "invoice" ? "active" : ""}`} id="screen-invoice">
        <InvoiceScreen
          basket={basket}
          setBasket={setBasket}
          merchantAddress={merchantAddress}
          customerAddress={customerAddress}
          customerAddressRef={customerAddressRef}
          checkoutPhase={checkoutPhase}
          setCheckoutPhase={setCheckoutPhase}
          waitingText={waitingText}
          setWaitingText={setWaitingText}
          showToast={showToast}
          startCheckoutMode={startCheckoutMode}
          hardResetWalletConnection={hardResetWalletConnection}
          disconnect={hardDisconnect}
          onSuccess={(sale) => {
            setLastSale(sale);
            addSaleToHistory(sale);
            setBasket([]);
            setScreen("success");
          }}
          onBack={() => {
            hardResetWalletConnection();
            setScreen("basket");
          }}
        />
      </div>

      <div className={`screen ${screen === "success" ? "active" : ""}`} id="screen-success">
        <SuccessScreen
          sale={lastSale}
          onNewSale={() => setScreen("basket")}
        />
      </div>

      <div className={`screen ${screen === "history" ? "active" : ""}`} id="screen-history">
        <HistoryScreen
          merchantAddress={merchantAddress}
          salesHistory={salesHistory}
          setSalesHistory={setSalesHistory}
          showToast={showToast}
        />
      </div>

      {screen !== "success" && (
        <BottomNav activeTab={screen} onTab={setScreen} />
      )}

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}