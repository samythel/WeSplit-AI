import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  ErrorCode,
  type Purchase,
  type PurchaseError,
  type ProductSubscription,
} from "react-native-iap";
import * as FileSystem from "expo-file-system/legacy";
import { readEncryptedJson, writeEncryptedJson } from "../services/EncryptedFileStore";

const PRODUCT_IDS = ["wesplit_pro_monthly", "wesplit_pro_annual"] as const;
type ProductId = typeof PRODUCT_IDS[number];
const FREE_SCAN_LIMIT = 5;

const SCAN_COUNTER_FILE = `${FileSystem.documentDirectory}wesplit-scan-counter-v1.json`;
const PRO_STATUS_FILE = `${FileSystem.documentDirectory}wesplit-pro-status-v1.json`;

interface ScanCounter {
  month: string;
  count: number;
}

function isKnownProductId(productId: string): productId is ProductId {
  return PRODUCT_IDS.includes(productId as ProductId);
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export interface SubscriptionProduct {
  productId: string;
  title: string;
  localizedPrice: string;
  price: number;
  currency: string;
}

interface SubscriptionContextValue {
  isPro: boolean;
  isLoading: boolean;
  products: SubscriptionProduct[];
  purchase: (productId: string) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  scansUsedThisMonth: number;
  scansRemaining: number;
  canScan: boolean;
  recordScan: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

function mapProduct(sub: ProductSubscription): SubscriptionProduct {
  return {
    productId: sub.id,
    title: sub.title,
    localizedPrice: sub.displayPrice,
    price: sub.price ?? 0,
    currency: sub.currency,
  };
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [scanCounter, setScanCounter] = useState<ScanCounter>({ month: currentMonthKey(), count: 0 });

  // Load scan counter from disk
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const parsed = await readEncryptedJson<unknown>(SCAN_COUNTER_FILE);
        if (!parsed || !mounted) return;
        const normalized = parsed as ScanCounter;
        if (normalized && typeof normalized.month === "string" && typeof normalized.count === "number") {
          if (normalized.month === currentMonthKey()) {
            setScanCounter(normalized);
          }
        }
      } catch {
        // Ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Remove legacy cached pro status so local file tampering cannot unlock premium.
  useEffect(() => {
    FileSystem.deleteAsync(PRO_STATUS_FILE, { idempotent: true }).catch(() => {
      // Ignore cleanup failures.
    });
  }, []);

  // Persist scan counter
  useEffect(() => {
    writeEncryptedJson(SCAN_COUNTER_FILE, scanCounter).catch(() => {});
  }, [scanCounter]);

  // Initialize store connection, fetch products, check existing purchases
  useEffect(() => {
    let purchaseListener: { remove: () => void } | null = null;
    let errorListener: { remove: () => void } | null = null;

    const init = async () => {
      try {
        await initConnection();

        // Fetch subscription products from the store
        const result = await fetchProducts({ skus: [...PRODUCT_IDS], type: "subs" });
        if (result) {
          const subs = (Array.isArray(result) ? result : []) as ProductSubscription[];
          setProducts(subs.map(mapProduct));
        }

        // Check for existing active subscriptions
        const purchases = await getAvailablePurchases();
        const hasActive = purchases.some((p) => isKnownProductId(p.productId));
        setIsPro(hasActive);
      } catch (e) {
        console.warn("[SubscriptionContext] init error:", e);
      } finally {
        setIsLoading(false);
      }
    };

    // Listen for successful purchases
    purchaseListener = purchaseUpdatedListener(async (purchase: Purchase) => {
      if (!isKnownProductId(purchase.productId)) {
        return;
      }
      setIsPro(true);
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (error) {
        console.warn("[SubscriptionContext] finishTransaction error:", error);
      }
    });

    // Listen for purchase errors
    errorListener = purchaseErrorListener((error: PurchaseError) => {
      if (error.code !== ErrorCode.UserCancelled) {
        console.warn("[SubscriptionContext] purchase error:", error);
      }
    });

    init();

    return () => {
      purchaseListener?.remove();
      errorListener?.remove();
      endConnection();
    };
  }, []);

  const purchase = useCallback(async (productId: string): Promise<boolean> => {
    if (!isKnownProductId(productId)) {
      throw new Error("Invalid subscription product.");
    }

    try {
      if (Platform.OS === "ios") {
        await requestPurchase({
          type: "subs",
          request: { apple: { sku: productId } },
        });
      } else {
        await requestPurchase({
          type: "subs",
          request: { google: { skus: [productId] } },
        });
      }
      // The purchaseUpdatedListener handles setting isPro
      return true;
    } catch (e: any) {
      if (e?.code === ErrorCode.UserCancelled) return false;
      throw e;
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const purchases = await getAvailablePurchases();
      const hasActive = purchases.some((p) => isKnownProductId(p.productId));
      setIsPro(hasActive);
      return hasActive;
    } catch (e) {
      console.warn("[SubscriptionContext] restore error:", e);
      return false;
    }
  }, []);

  const recordScan = useCallback(() => {
    setScanCounter((prev) => {
      const month = currentMonthKey();
      if (prev.month !== month) {
        return { month, count: 1 };
      }
      return { ...prev, count: prev.count + 1 };
    });
  }, []);

  const scansUsedThisMonth = scanCounter.month === currentMonthKey() ? scanCounter.count : 0;
  const scansRemaining = Math.max(0, FREE_SCAN_LIMIT - scansUsedThisMonth);
  const canScan = isPro || scansRemaining > 0;

  const value = useMemo(
    () => ({
      isPro,
      isLoading,
      products,
      purchase,
      restorePurchases,
      scansUsedThisMonth,
      scansRemaining,
      canScan,
      recordScan,
    }),
    [isPro, isLoading, products, purchase, restorePurchases, scansUsedThisMonth, scansRemaining, canScan, recordScan],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) {
    throw new Error("useSubscription must be used within SubscriptionProvider");
  }
  return value;
}
