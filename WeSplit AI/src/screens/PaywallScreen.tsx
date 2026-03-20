import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check } from "lucide-react-native";
import { useSubscription, SubscriptionProduct } from "../context/SubscriptionContext";
import { useI18n } from "../i18n/I18nProvider";

interface PaywallScreenProps {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

export function PaywallScreen({ visible, onClose, isDarkMode }: PaywallScreenProps) {
  const { t } = useI18n();
  const { products, purchase, restorePurchases, isPro } = useSubscription();
  const [purchasing, setPurchasing] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const androidBottomInset = Platform.OS === "android"
    ? Math.max(0, Dimensions.get("screen").height - Dimensions.get("window").height)
    : 0;
  const paywallBottomPadding = 30 + (Platform.OS === "android" ? Math.max(44, androidBottomInset + 12) : 0);

  const colors = isDarkMode
    ? {
        bg: "#101828",
        card: "#1F2A37",
        cardSelected: "#1A3A5C",
        border: "#344054",
        borderSelected: "#1570EF",
        textPrimary: "#F2F4F7",
        textSecondary: "#D0D5DD",
        textMuted: "#98A2B3",
        accent: "#1570EF",
        accentText: "#FFFFFF",
        badge: "#1570EF",
        checkBg: "#D1E9FF",
        checkFg: "#1570EF",
      }
    : {
        bg: "#F5F7FB",
        card: "#FFFFFF",
        cardSelected: "#EFF8FF",
        border: "#EAECF0",
        borderSelected: "#1570EF",
        textPrimary: "#101828",
        textSecondary: "#475467",
        textMuted: "#667085",
        accent: "#1570EF",
        accentText: "#FFFFFF",
        badge: "#1570EF",
        checkBg: "#D1E9FF",
        checkFg: "#1570EF",
      };

  const monthlyProduct = products.find((p) => p.productId === "wesplit_pro_monthly");
  const annualProduct = products.find((p) => p.productId === "wesplit_pro_annual");

  const selected = selectedProductId
    ? products.find((p) => p.productId === selectedProductId) ?? annualProduct ?? monthlyProduct
    : annualProduct ?? monthlyProduct;

  const handlePurchase = async (product: SubscriptionProduct | undefined) => {
    if (!product) return;
    setPurchasing(true);
    try {
      const success = await purchase(product.productId);
      if (success) {
        onClose();
      }
    } catch (e: any) {
      Alert.alert(t("paywall.errorTitle"), e?.message ?? t("paywall.errorGeneric"));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    try {
      const restored = await restorePurchases();
      if (restored) {
        onClose();
      } else {
        Alert.alert(t("paywall.errorTitle"), t("paywall.restoreError"));
      }
    } catch {
      Alert.alert(t("paywall.errorTitle"), t("paywall.restoreError"));
    } finally {
      setPurchasing(false);
    }
  };

  if (isPro) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={[styles.root, { backgroundColor: colors.bg }]}>
          <View style={[styles.content, { paddingBottom: paywallBottomPadding }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("paywall.alreadyPro")}</Text>
            <Pressable style={[styles.ctaButton, { backgroundColor: colors.accent }]} onPress={onClose}>
              <Text style={[styles.ctaText, { color: colors.accentText }]}>{t("paywall.close")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const features = [
    t("paywall.feature.unlimitedScans"),
    t("paywall.feature.fullHistory"),
    t("paywall.feature.priorityAI"),
    t("paywall.feature.noAds"),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={[styles.content, { paddingBottom: paywallBottomPadding }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("paywall.title")}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("paywall.subtitle")}</Text>

          <View style={styles.featureList}>
            {features.map((feature, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.checkCircle, { backgroundColor: colors.checkBg }]}>
                  <Check size={14} color={colors.checkFg} strokeWidth={3} />
                </View>
                <Text style={[styles.featureText, { color: colors.textPrimary }]}>{feature}</Text>
              </View>
            ))}
          </View>

          <View style={styles.plansContainer}>
            {annualProduct && (
              <Pressable
                style={[
                  styles.planCard,
                  {
                    backgroundColor: selected?.productId === annualProduct.productId ? colors.cardSelected : colors.card,
                    borderColor: selected?.productId === annualProduct.productId ? colors.borderSelected : colors.border,
                  },
                ]}
                onPress={() => setSelectedProductId(annualProduct.productId)}
              >
                <View style={styles.planHeader}>
                  <Text style={[styles.planName, { color: colors.textPrimary }]}>{t("paywall.plan.annual")}</Text>
                  <View style={[styles.saveBadge, { backgroundColor: colors.badge }]}>
                    <Text style={styles.saveBadgeText}>{t("paywall.plan.annualSave")}</Text>
                  </View>
                </View>
                <Text style={[styles.planPrice, { color: colors.textPrimary }]}>
                  {annualProduct.localizedPrice}/{t("paywall.plan.year")}
                </Text>
                <Text style={[styles.planDetail, { color: colors.textMuted }]}>
                  {t("paywall.plan.annualMonthly", { price: (annualProduct.price / 12).toFixed(2) })}
                </Text>
              </Pressable>
            )}
            {monthlyProduct && (
              <Pressable
                style={[
                  styles.planCard,
                  {
                    backgroundColor: selected?.productId === monthlyProduct.productId ? colors.cardSelected : colors.card,
                    borderColor: selected?.productId === monthlyProduct.productId ? colors.borderSelected : colors.border,
                  },
                ]}
                onPress={() => setSelectedProductId(monthlyProduct.productId)}
              >
                <Text style={[styles.planName, { color: colors.textPrimary }]}>{t("paywall.plan.monthly")}</Text>
                <Text style={[styles.planPrice, { color: colors.textPrimary }]}>
                  {monthlyProduct.localizedPrice}/{t("paywall.plan.month")}
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: colors.accent, opacity: pressed || purchasing ? 0.85 : 1 },
            ]}
            onPress={() => handlePurchase(selected)}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.accentText }]}>{t("paywall.subscribe")}</Text>
            )}
          </Pressable>

          <Pressable onPress={handleRestore} disabled={purchasing}>
            <Text style={[styles.restoreText, { color: colors.textMuted }]}>{t("paywall.restore")}</Text>
          </Pressable>

          <Text style={[styles.legalText, { color: colors.textMuted }]}>
            {t("paywall.legal")}{" "}
            <Text
              style={[styles.legalLink, { color: colors.accent }]}
              onPress={() => Linking.openURL("https://samythel.github.io/WeSplit-AI/terms")}
            >
              {t("paywall.termsOfUse")}
            </Text>
            {" · "}
            <Text
              style={[styles.legalLink, { color: colors.accent }]}
              onPress={() => Linking.openURL("https://samythel.github.io/WeSplit-AI/privacy")}
            >
              {t("paywall.privacyPolicy")}
            </Text>
          </Text>

          <Pressable style={styles.closeArea} onPress={onClose}>
            <Text style={[styles.closeText, { color: colors.textMuted }]}>{t("paywall.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 70 : 50,
    paddingBottom: 30,
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 22,
  },
  featureList: {
    gap: 14,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  featureText: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  plansContainer: {
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planName: {
    fontSize: 16,
    fontWeight: "700",
  },
  saveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  saveBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  planPrice: {
    fontSize: 20,
    fontWeight: "800",
    marginTop: 4,
  },
  planDetail: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  ctaButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: "700",
  },
  restoreText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
  },
  legalText: {
    fontSize: 11,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 12,
  },
  legalLink: {
    fontSize: 11,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  closeArea: {
    paddingVertical: 8,
    alignItems: "center",
  },
  closeText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
