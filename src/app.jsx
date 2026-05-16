import { useState, useRef, useEffect, useCallback } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import BasketScreen from "./screens/basketScreen";
import InvoiceScreen from "./screens/invoiceScreen";
import SuccessScreen from "./screens/successScreen";
import HistoryScreen from "./screens/historyScreen";
import BottomNav from "./components/bottomNav";
import Toast from "./components/toast";

// ─── Constants ────────────────────────────────────────────────────────────────
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
    { type: "address", name: "merchant", indexed: true },
    { type: "address", name: "customer", indexed: true },
    { type: "uint256", name: "totalAmount", indexed: false },
    { type: "string[]", name: "items", indexed: false },
    { type: "uint256[]", name: "prices", indexed: false },
    { type: "uint256", name: "timestamp", indexed: false },
    { type: "bool", name: "isUSDC", indexed: false },
  ],
};

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("basket"); // basket | invoice | success | history
  const [basket, setBasket] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]);
  const [lastSale, setLastSale] = useState(null);
  const [toast, setToast] = useState(null);
  const [checkoutPhase, setCheckoutPhase] = useState("connect"); // connect | approve | pay
  const [waitingText, setWaitingText] = useState("Waiting for customer…");

  // Merchant wallet — persisted across checkout flow
  const merchantAddressRef = useRef(null);
  const [merchantAddress, setMerchantAddress] = useState(null);

  // Whether we're in checkout mode (so wallet connect events go to customer)
  const checkoutInProgressRef = useRef(false);
  const [checkoutInProgress, setCheckoutInProgress] = useState(false);

  const [customerAddress, setCustomerAddress] = useState(null);
  const customerAddressRef = useRef(null);

  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  // ── Wallet change handler ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !address) {
      if (!checkoutInProgressRef.current) {
        merchantAddressRef.current = null;
        setMerchantAddress(null);
      }
      return;
    }

    if (checkoutInProgressRef.current) {
      // This wallet connect is the CUSTOMER during checkout
      customerAddressRef.current = address;
      setCustomerAddress(address);
    } else {
      // Normal merchant connect
      merchantAddressRef.current = address;
      setMerchantAddress(address);
    }
  }, [address, isConnected]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type, id: Date.now() });
  }, []);

  // ── Checkout state helpers ────────────────────────────────────────────────
  const startCheckoutMode = useCallback(() => {
    checkoutInProgressRef.current = true;
    setCheckoutInProgress(true);
    customerAddressRef.current = null;
    setCustomerAddress(null);
  }, []);

  const endCheckoutMode = useCallback(() => {
    checkoutInProgressRef.current = false;
    setCheckoutInProgress(false);
    customerAddressRef.current = null;
    setCustomerAddress(null);
  }, []);

  // ── History merge helper ──────────────────────────────────────────────────
  const addSaleToHistory = useCallback((sale) => {
    setSalesHistory((prev) => {
      // Deduplicate by txHash
      if (prev.find((s) => s.id === sale.id)) return prev;
      return [sale, ...prev];
    });
  }, []);

  return (
    <div className="app-shell">
      {/* ── Screens ─────────────────────────────────────────────────────── */}
      <div className={`screen ${screen === "basket" ? "active" : ""}`} id="screen-basket">
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
          endCheckoutMode={endCheckoutMode}
          disconnect={disconnect}
          onSuccess={(sale) => {
            setLastSale(sale);
            addSaleToHistory(sale);
            endCheckoutMode();
            setBasket([]);
            setScreen("success");
          }}
          onBack={() => {
            disconnect();
            endCheckoutMode();
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

      {/* ── Bottom Nav ───────────────────────────────────────────────────── */}
      {screen !== "invoice" && screen !== "success" && (
        <BottomNav activeTab={screen} onTab={setScreen} />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}