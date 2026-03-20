import {
  Animated,
  Appearance,
  LayoutChangeEvent,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Dimensions,
} from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, History, Languages, Menu, Mic, Monitor, Moon, Pencil, Search, Sun, User, Users } from "lucide-react-native";
import { CameraScreen } from "./src/screens/CameraScreen";
import { AIService } from "./src/services/AIService";
import { AppStateProvider, useAppState } from "./src/context/AppStateContext";
import { I18nProvider, useI18n } from "./src/i18n/I18nProvider";
import { SubscriptionProvider, useSubscription } from "./src/context/SubscriptionContext";
import { PaywallScreen } from "./src/screens/PaywallScreen";

const SUPPORTED_LANGUAGES = ["en", "es", "fr", "pt", "de", "it", "ru", "tr", "ja", "ko", "zh", "hi", "ar", "he", "th", "pl", "nl", "id", "vi", "da", "sv", "no"] as const;

export default function App() {
  return (
    <I18nProvider>
      <AppStateProvider>
        <SubscriptionProvider>
          <AppContent />
        </SubscriptionProvider>
      </AppStateProvider>
    </I18nProvider>
  );
}

function AppContent() {
  const aiService = useMemo(() => new AIService(), []);
  const { t, locale, language, setLanguage, formatDateTime } = useI18n();
  const {
    historyEntries,
    setReceiptAnalysis,
    userName,
    setUserName,
    isUserProfileLoaded,
    hasSeenOnboarding,
    setHasSeenOnboarding,
    isOnboardingLoaded,
    themeMode,
    setThemeMode,
  } = useAppState();
  const [systemColorScheme, setSystemColorScheme] = useState<"light" | "dark">(
    () => Appearance.getColorScheme() === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme(colorScheme === "dark" ? "dark" : "light");
    });
    return () => subscription.remove();
  }, []);
  const isDarkMode = themeMode === "system" ? systemColorScheme === "dark" : themeMode === "dark";
  const colors = useMemo(
    () =>
      isDarkMode
        ? {
            page: "#101828",
            sheet: "#182230",
            card: "#1F2A37",
            cardAlt: "#243241",
            border: "#344054",
            textPrimary: "#F2F4F7",
            textSecondary: "#D0D5DD",
            textMuted: "#98A2B3",
            overlay: "rgba(2, 6, 23, 0.72)",
            menuPressedBg: "#1570EF",
            accent: "#1570EF",
          }
        : {
            page: "#F5F7FB",
            sheet: "#FFFFFF",
            card: "#FFFFFF",
            cardAlt: "#F9FAFB",
            border: "#EAECF0",
            textPrimary: "#101828",
            textSecondary: "#475467",
            textMuted: "#667085",
            overlay: "rgba(16, 24, 40, 0.45)",
            menuPressedBg: "#1570EF",
            accent: "#1570EF",
          },
    [isDarkMode],
  );
  const statusBarTopInset = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const androidBottomInset = Platform.OS === "android"
    ? Math.max(0, Dimensions.get("screen").height - Dimensions.get("window").height)
    : 0;
  // Some Samsung builds report a tiny/zero inset while still overlaying 3-button navigation.
  // Keep a conservative minimum so bottom actions never sit under the nav bar.
  const bottomSheetInset = Platform.OS === "android" ? Math.max(44, androidBottomInset + 12) : 0;
  const { isPro, scansRemaining } = useSubscription();
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [draftUserName, setDraftUserName] = useState("");
  const [isNameKeyboardVisible, setIsNameKeyboardVisible] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [onboardingPageIndex, setOnboardingPageIndex] = useState(0);
  const [onboardingPagerWidth, setOnboardingPagerWidth] = useState(0);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const onboardingScrollRef = useRef<ScrollView | null>(null);
  const onboardingPages = useMemo(
    () => [
      {
        icon: "scan",
        title: t("onboarding.page1.title"),
        body: t("onboarding.page1.body"),
      },
      {
        icon: "people",
        title: t("onboarding.page2.title"),
        body: t("onboarding.page2.body"),
      },
      {
        icon: "input",
        title: t("onboarding.page3.title"),
        body: t("onboarding.page3.body"),
      },
      {
        icon: "done",
        title: t("onboarding.page4.title"),
        body: t("onboarding.page4.body"),
      },
    ],
    [t],
  );
  const isOnboardingVisible = isOnboardingLoaded && !hasSeenOnboarding;
  const isNameRequired = isUserProfileLoaded && !userName && !isOnboardingVisible;

  const closeVisibleSheet = useCallback(() => {
    if (isLanguageOpen) {
      setIsLanguageOpen(false);
      setLanguageSearch("");
      return;
    }
    if (isHistoryOpen) {
      setIsHistoryOpen(false);
      return;
    }
    if (isMenuOpen) {
      setIsMenuOpen(false);
    }
  }, [isHistoryOpen, isLanguageOpen, isMenuOpen]);

  const anySheetOpen = isMenuOpen || isHistoryOpen || isLanguageOpen;
  const getLanguageLabel = useCallback(
    (langCode: (typeof SUPPORTED_LANGUAGES)[number]) => {
      const label = t(`language.option.${langCode}`);
      if (!label) {
        return label;
      }
      const [firstChar, ...rest] = Array.from(label);
      if (!firstChar) {
        return label;
      }
      return `${firstChar.toLocaleUpperCase(locale)}${rest.join("")}`;
    },
    [locale, t],
  );
  const sortedLanguageCodes = useMemo(
    () =>
      [...SUPPORTED_LANGUAGES].sort((a, b) =>
        getLanguageLabel(a).localeCompare(getLanguageLabel(b), locale),
      ),
    [getLanguageLabel, locale],
  );
  const filteredLanguageCodes = useMemo(() => {
    if (!languageSearch.trim()) return sortedLanguageCodes;
    const query = languageSearch.trim().toLowerCase();
    return sortedLanguageCodes.filter((code) =>
      getLanguageLabel(code).toLowerCase().includes(query),
    );
  }, [sortedLanguageCodes, languageSearch, getLanguageLabel]);
  const isLastOnboardingPage = onboardingPageIndex === onboardingPages.length - 1;

  const handleOnboardingPagerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.floor(event.nativeEvent.layout.width);
    if (width > 0) {
      setOnboardingPagerWidth(width);
    }
  }, []);

  const goToOnboardingPage = useCallback(
    (nextIndex: number) => {
      setOnboardingPageIndex(nextIndex);
      if (onboardingPagerWidth > 0) {
        onboardingScrollRef.current?.scrollTo({ x: onboardingPagerWidth * nextIndex, animated: true });
      }
    },
    [onboardingPagerWidth],
  );

  const finishOnboarding = useCallback(() => {
    setHasSeenOnboarding(true);
    setOnboardingPageIndex(0);
  }, [setHasSeenOnboarding]);

  const onOnboardingNext = useCallback(() => {
    if (isLastOnboardingPage) {
      finishOnboarding();
      return;
    }
    goToOnboardingPage(onboardingPageIndex + 1);
  }, [finishOnboarding, goToOnboardingPage, isLastOnboardingPage, onboardingPageIndex]);

  const animateSheetOpen = useCallback(() => {
    sheetTranslateY.setValue(28);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, sheetTranslateY]);

  const animateSheetSnap = useCallback(() => {
    sheetTranslateY.setValue(18);
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [sheetTranslateY]);

  const animateSheetClose = useCallback(
    (onClosed: () => void) => {
      Animated.parallel([
        Animated.timing(sheetTranslateY, {
          toValue: 360,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 170,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        sheetTranslateY.setValue(0);
        backdropOpacity.setValue(0);
        onClosed();
      });
    },
    [backdropOpacity, sheetTranslateY],
  );

  useEffect(() => {
    if (anySheetOpen) {
      animateSheetOpen();
    }
  }, [animateSheetOpen, anySheetOpen]);

  useEffect(() => {
    if (isNameRequired) {
      setDraftUserName("");
      setIsNameModalOpen(true);
    }
  }, [isNameRequired]);

  useEffect(() => {
    if (!isOnboardingVisible || onboardingPagerWidth <= 0) {
      return;
    }
    onboardingScrollRef.current?.scrollTo({ x: 0, animated: false });
    setOnboardingPageIndex(0);
  }, [isOnboardingVisible, onboardingPagerWidth]);

  useEffect(() => {
    if (!isNameModalOpen) {
      setIsNameKeyboardVisible(false);
      return;
    }

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsNameKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsNameKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isNameModalOpen]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          gestureState.dy > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_event, gestureState) => {
          sheetTranslateY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_event, gestureState) => {
          const shouldClose = gestureState.dy > 70 || gestureState.vy > 0.95;
          if (shouldClose) {
            animateSheetClose(closeVisibleSheet);
            return;
          }
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 22,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 22,
          }).start();
        },
      }),
    [animateSheetClose, closeVisibleSheet, sheetTranslateY],
  );
  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => Math.abs(gestureState.dy) > 1,
        onMoveShouldSetPanResponder: (_event, gestureState) => Math.abs(gestureState.dy) > 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gestureState) => {
          sheetTranslateY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_event, gestureState) => {
          const isTap = Math.abs(gestureState.dy) < 6 && Math.abs(gestureState.vy) < 0.15;
          const shouldClose = gestureState.dy > 50 || gestureState.vy > 0.8;
          if (isTap || shouldClose) {
            animateSheetClose(closeVisibleSheet);
            return;
          }
          animateSheetSnap();
        },
        onPanResponderTerminate: () => {
          animateSheetSnap();
        },
      }),
    [animateSheetClose, animateSheetSnap, closeVisibleSheet, sheetTranslateY],
  );

  const openHistory = () => {
    setIsMenuOpen(false);
    setIsHistoryOpen(true);
    animateSheetSnap();
  };

  const openLanguage = () => {
    setIsMenuOpen(false);
    setLanguageSearch("");
    setIsLanguageOpen(true);
    animateSheetSnap();
  };

  const openNameEditor = () => {
    animateSheetClose(() => {
      setIsMenuOpen(false);
      setDraftUserName(userName ?? "");
      setIsNameModalOpen(true);
    });
  };

  const saveUserName = () => {
    const trimmed = draftUserName.trim();
    if (!trimmed) {
      return;
    }
    setUserName(trimmed);
    setIsNameModalOpen(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.page }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={colors.page} translucent={false} />
      <View style={[styles.header, { paddingTop: 8 + statusBarTopInset }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerMain}>
            <Image source={require("./assets/WeSplit text.png")} style={styles.logoWordmark} resizeMode="contain" />
            <Text style={[styles.logoTagline, { color: colors.textMuted }]}>{t("app.tagline")}</Text>
            {!isPro && (
              <View style={[styles.scansBadge, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
                <Text style={[styles.scansBadgeText, { color: colors.textMuted }]}>
                  {t("header.scansLeft", { count: scansRemaining })}
                </Text>
              </View>
            )}
            {isPro && (
              <View style={[styles.scansBadge, styles.scansBadgePro]}>
                <Text style={styles.scansBadgeProText}>{t("header.scansPro")}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.menuButton, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => {
              setIsHistoryOpen(false);
              setIsLanguageOpen(false);
              setIsMenuOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("home.menu.open")}
          >
            <Menu size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.screenContainer}>
        <CameraScreen aiService={aiService} isDarkMode={isDarkMode} />
      </View>

      <Modal visible={isMenuOpen} transparent animationType="fade" onRequestClose={() => setIsMenuOpen(false)}>
        <TouchableWithoutFeedback onPress={() => animateSheetClose(() => setIsMenuOpen(false))}>
          <Animated.View style={[styles.overlay, { opacity: backdropOpacity, backgroundColor: colors.overlay }]}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.menuSheet,
                  { backgroundColor: colors.sheet },
                  { paddingBottom: 20 + bottomSheetInset },
                  { transform: [{ translateY: sheetTranslateY }] },
                ]}
                {...sheetPanResponder.panHandlers}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={t("home.menu.close")}
                  style={styles.sheetHandleButton}
                  {...handlePanResponder.panHandlers}
                >
                  <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
                </View>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>{t("home.menu.title")}</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={openHistory}
                >
                  {({ pressed }) => (
                    <>
                      <History size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} />
                      <Text style={[styles.menuItemText, { color: colors.textSecondary }, pressed && styles.menuItemTextPressed]}>{t("home.menu.history")}</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={openLanguage}
                >
                  {({ pressed }) => (
                    <>
                      <Languages size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} />
                      <Text style={[styles.menuItemText, { color: colors.textSecondary }, pressed && styles.menuItemTextPressed]}>{t("home.menu.language")}</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={() => {
                    if (themeMode === "system") setThemeMode("light");
                    else if (themeMode === "light") setThemeMode("dark");
                    else setThemeMode("system");
                  }}
                >
                  {({ pressed }) => (
                    <>
                      {themeMode === "system" ? <Monitor size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} /> : isDarkMode ? <Sun size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} /> : <Moon size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} />}
                      <Text style={[styles.menuItemText, { color: colors.textSecondary }, pressed && styles.menuItemTextPressed]}>
                        {themeMode === "system" ? t("theme.system") : isDarkMode ? t("theme.light") : t("theme.dark")}
                      </Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={openNameEditor}
                >
                  {({ pressed }) => (
                    <>
                      <User size={16} color={pressed ? "#FFFFFF" : colors.textSecondary} />
                      <Text style={[styles.menuItemText, { color: colors.textSecondary }, pressed && styles.menuItemTextPressed]}>{t("home.menu.profileName")}</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.monetizationCard,
                    { backgroundColor: pressed ? colors.accent : colors.cardAlt, borderColor: pressed ? colors.accent : colors.border },
                  ]}
                  onPress={() => {
                    setIsMenuOpen(false);
                    setIsPaywallOpen(true);
                  }}
                >
                  {({ pressed }) => (
                    <>
                      <Text style={[styles.monetizationTitle, { color: pressed ? "#FFFFFF" : colors.textPrimary }]}>{t("home.menu.monetizationTitle")}</Text>
                      <Text style={[styles.monetizationOffer, { color: pressed ? "rgba(255,255,255,0.85)" : colors.textSecondary }]}>
                        {isPro ? t("home.menu.scansUnlimited") : t("home.menu.scansRemaining", { count: scansRemaining })}
                      </Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuCloseButton,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuCloseButtonPressed,
                  ]}
                  onPress={() => animateSheetClose(() => setIsMenuOpen(false))}
                >
                  {({ pressed }) => (
                    <Text style={[styles.menuCloseText, { color: colors.textSecondary }, pressed && styles.menuCloseTextPressed]}>{t("home.menu.close")}</Text>
                  )}
                </Pressable>
              </Animated.View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={isLanguageOpen}
        transparent
        animationType="fade"
        onRequestClose={() => animateSheetClose(() => setIsLanguageOpen(false))}
      >
        <TouchableWithoutFeedback onPress={() => animateSheetClose(() => setIsLanguageOpen(false))}>
          <Animated.View style={[styles.overlay, { opacity: backdropOpacity, backgroundColor: colors.overlay }]}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.languageSheet,
                  { backgroundColor: colors.sheet },
                  { paddingBottom: 20 + bottomSheetInset },
                  { transform: [{ translateY: sheetTranslateY }] },
                ]}
                {...sheetPanResponder.panHandlers}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={t("home.menu.close")}
                  style={styles.sheetHandleButton}
                  {...handlePanResponder.panHandlers}
                >
                  <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
                </View>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>{t("language.title")}</Text>
                <View style={[styles.languageSearchWrap, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
                  <Search size={14} color={colors.textMuted} />
                  <TextInput
                    style={[styles.languageSearchInput, { color: colors.textPrimary }]}
                    placeholder={t("language.search")}
                    placeholderTextColor={colors.textMuted}
                    value={languageSearch}
                    onChangeText={setLanguageSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </View>
                <ScrollView style={styles.languageList} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
                  {filteredLanguageCodes.map((langCode) => (
                    <Pressable
                      key={langCode}
                      style={({ pressed }) => [
                        styles.languageRow,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        pressed && styles.languageRowPressed,
                      ]}
                      onPress={() => {
                        setLanguage(langCode);
                        animateSheetClose(() => setIsLanguageOpen(false));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={getLanguageLabel(langCode)}
                    >
                      {({ pressed }) => (
                        <>
                          <Text style={[styles.languageText, { color: colors.textSecondary }, pressed && styles.languageTextPressed]}>
                            {getLanguageLabel(langCode)}
                          </Text>
                          {language === langCode ? <Check size={16} color={pressed ? "#FFFFFF" : "#1570EF"} /> : null}
                        </>
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuCloseButton,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuCloseButtonPressed,
                  ]}
                  onPress={() => animateSheetClose(() => setIsLanguageOpen(false))}
                >
                  {({ pressed }) => (
                    <Text style={[styles.menuCloseText, { color: colors.textSecondary }, pressed && styles.menuCloseTextPressed]}>{t("home.menu.close")}</Text>
                  )}
                </Pressable>
              </Animated.View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={isHistoryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => animateSheetClose(() => setIsHistoryOpen(false))}
      >
        <TouchableWithoutFeedback onPress={() => animateSheetClose(() => setIsHistoryOpen(false))}>
          <Animated.View style={[styles.overlay, { opacity: backdropOpacity, backgroundColor: colors.overlay }]}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.historySheet,
                  { backgroundColor: colors.sheet },
                  { paddingBottom: 20 + bottomSheetInset },
                  { transform: [{ translateY: sheetTranslateY }] },
                ]}
                {...sheetPanResponder.panHandlers}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={t("home.menu.close")}
                  style={styles.sheetHandleButton}
                  {...handlePanResponder.panHandlers}
                >
                  <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
                </View>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>{t("history.title")}</Text>
                <Text style={[styles.historyHint, { color: colors.textMuted }]}>{t("history.savedLocal")}</Text>
                {historyEntries.length === 0 ? (
                  <Text style={[styles.emptyHistoryText, { color: colors.textMuted }]}>{t("history.empty")}</Text>
                ) : (
                  <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
                    {historyEntries.map((entry) => {
                      const totalValue =
                        entry.analysis.subtotal +
                        entry.analysis.tax +
                        entry.analysis.tip +
                        (entry.analysis.serviceFee ?? 0);
                      return (
                        <Pressable
                          key={entry.id}
                          style={({ pressed }) => [
                            styles.historyCard,
                            { backgroundColor: colors.cardAlt, borderColor: colors.border },
                            pressed && styles.historyCardPressed,
                          ]}
                          onPress={() => {
                            setReceiptAnalysis(entry.analysis);
                            animateSheetClose(() => setIsHistoryOpen(false));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={formatDateTime(entry.createdAt)}
                        >
                          {({ pressed }) => (
                            <>
                              {entry.analysis.restaurantName ? (
                                <Text style={[styles.historyRestaurant, { color: colors.textPrimary }, pressed && styles.historyDatePressed]}>
                                  {entry.analysis.restaurantName}
                                </Text>
                              ) : null}
                              <Text style={[styles.historyDate, { color: entry.analysis.restaurantName ? colors.textMuted : colors.textPrimary }, pressed && styles.historyDatePressed]}>{formatDateTime(entry.createdAt)}</Text>
                              <View style={styles.historyMetaRow}>
                                <Text style={[styles.historyMeta, { color: colors.textMuted }, pressed && styles.historyMetaPressed]}>
                                  {t("history.entry.items", { count: entry.analysis.items.length })}
                                </Text>
                                <Text style={[styles.historyMeta, { color: colors.textMuted }, pressed && styles.historyMetaPressed]}>
                                  {t("history.entry.total", {
                                    total: totalValue.toFixed(2),
                                  })}
                                </Text>
                              </View>
                            </>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.menuCloseButton,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    pressed && styles.menuCloseButtonPressed,
                  ]}
                  onPress={() => animateSheetClose(() => setIsHistoryOpen(false))}
                >
                  {({ pressed }) => (
                    <Text style={[styles.menuCloseText, { color: colors.textSecondary }, pressed && styles.menuCloseTextPressed]}>{t("home.menu.close")}</Text>
                  )}
                </Pressable>
              </Animated.View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={isOnboardingVisible}
        transparent
        animationType="fade"
        onRequestClose={onOnboardingNext}
      >
        <View style={[styles.onboardingOverlay, { backgroundColor: isDarkMode ? "rgba(2, 6, 23, 0.78)" : "rgba(16, 24, 40, 0.7)" }]}>
          <View style={[styles.onboardingCard, { backgroundColor: colors.sheet, borderColor: colors.border }]}>
            <View style={styles.onboardingHeader}>
              <Image source={require("./assets/WeSplit text.png")} style={styles.onboardingLogo} resizeMode="contain" />
            </View>

            <View style={styles.onboardingPagerViewport} onLayout={handleOnboardingPagerLayout}>
              <ScrollView
                ref={onboardingScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(event) => {
                  if (onboardingPagerWidth <= 0) {
                    return;
                  }
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / onboardingPagerWidth);
                  setOnboardingPageIndex(Math.min(Math.max(nextIndex, 0), onboardingPages.length - 1));
                }}
              >
                {onboardingPages.map((page, index) => (
                  <View key={index} style={[styles.onboardingPage, { width: onboardingPagerWidth || 1 }]}>
                    <View style={styles.onboardingPageContent}>
                      <View style={styles.onboardingIconWrap}>
                        {page.icon === "scan" ? <Camera size={40} color="#1570EF" strokeWidth={2.4} /> : null}
                        {page.icon === "people" ? <Users size={40} color="#1570EF" strokeWidth={2.4} /> : null}
                        {page.icon === "done" ? <Check size={40} color="#1570EF" strokeWidth={2.8} /> : null}
                        {page.icon === "input" ? (
                          <View style={styles.onboardingDualIconRow}>
                            <Mic size={32} color="#1570EF" strokeWidth={2.3} />
                            <Pencil size={32} color="#1570EF" strokeWidth={2.3} />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.onboardingTitleWrap}>
                        <Text style={[styles.onboardingPageTitle, { color: colors.textPrimary }]}>{page.title}</Text>
                      </View>
                      <View style={styles.onboardingBodyWrap}>
                        <Text style={[styles.onboardingPageBody, { color: colors.textSecondary }]}>{page.body}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.onboardingDots}>
              {onboardingPages.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.onboardingDot,
                    { backgroundColor: isDarkMode ? "#475467" : "#D0D5DD" },
                    onboardingPageIndex === index && styles.onboardingDotActive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.onboardingActions}>
              {!isLastOnboardingPage ? (
                <TouchableOpacity style={styles.onboardingSecondaryBtn} onPress={finishOnboarding}>
                  <Text style={[styles.onboardingSecondaryText, { color: colors.textMuted }]}>{t("onboarding.skip")}</Text>
                </TouchableOpacity>
              ) : <View />}

              <TouchableOpacity style={styles.onboardingPrimaryBtn} onPress={onOnboardingNext}>
                <Text style={styles.onboardingPrimaryText}>
                  {isLastOnboardingPage ? t("onboarding.getStarted") : t("onboarding.next")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isNameModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isNameRequired) {
            setIsNameModalOpen(false);
          }
        }}
      >
        <TouchableWithoutFeedback
          onPress={() => {
            Keyboard.dismiss();
            if (!isNameRequired) {
              setIsNameModalOpen(false);
            }
          }}
        >
          <KeyboardAvoidingView
            style={styles.profileModalKeyboardContainer}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          >
            <View style={[styles.profileModalOverlay, { backgroundColor: colors.overlay }, isNameKeyboardVisible && styles.profileModalOverlayWithKeyboard]}>
              <TouchableWithoutFeedback>
                <View style={[styles.profileModalCard, { backgroundColor: colors.sheet, borderColor: colors.border }]}>
                  <Text style={[styles.profileModalTitle, { color: colors.textPrimary }]}>{t("profileName.title")}</Text>
                  <Text style={[styles.profileModalHint, { color: colors.textMuted }]}>{t("profileName.subtitle")}</Text>
                  <TextInput
                    style={[styles.profileModalInput, { borderColor: colors.border, backgroundColor: colors.cardAlt, color: colors.textPrimary }]}
                    value={draftUserName}
                    onChangeText={setDraftUserName}
                    placeholder={t("profileName.inputPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={saveUserName}
                  />
                  <View style={styles.profileModalActions}>
                    {!isNameRequired ? (
                      <TouchableOpacity
                        style={[styles.profileModalSecondaryBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
                        onPress={() => setIsNameModalOpen(false)}
                      >
                        <Text style={[styles.profileModalSecondaryText, { color: colors.textSecondary }]}>{t("profileName.cancel")}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.profileModalPrimaryBtn,
                        !draftUserName.trim() && styles.profileModalPrimaryBtnDisabled,
                      ]}
                      onPress={saveUserName}
                      disabled={!draftUserName.trim()}
                    >
                      <Text style={styles.profileModalPrimaryText}>{t("profileName.save")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
      <PaywallScreen visible={isPaywallOpen} onClose={() => setIsPaywallOpen(false)} isDarkMode={isDarkMode} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  headerMain: {
    alignItems: "center",
    gap: 2,
  },
  logoWordmark: {
    width: 168,
    height: 38,
  },
  logoTagline: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: "#667085",
    marginTop: -2,
  },
  scansBadge: {
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
  },
  scansBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#667085",
  },
  scansBadgePro: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  scansBadgeProText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  menuButton: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(16, 24, 40, 0.45)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#D0D5DD",
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetHandleButton: {
    alignSelf: "center",
    width: 140,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginBottom: 2,
  },
  languageSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
    minHeight: 280,
  },
  languageSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#EAECF0",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 0,
    backgroundColor: "#F9FAFB",
    marginBottom: 4,
  },
  languageSearchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    paddingVertical: 8,
    color: "#101828",
  },
  languageHint: {
    fontSize: 12,
    color: "#98A2B3",
    marginTop: -2,
    marginBottom: 2,
  },
  languageList: {
    maxHeight: 320,
  },
  historySheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
    maxHeight: "70%",
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#101828",
    marginBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#EAECF0",
  },
  menuItemPressed: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#344054",
  },
  menuItemTextPressed: {
    color: "#FFFFFF",
  },
  monetizationCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  monetizationTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#101828",
  },
  monetizationOffer: {
    fontSize: 13,
    fontWeight: "500",
    color: "#475467",
  },
  menuCloseButton: {
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    paddingVertical: 12,
  },
  menuCloseButtonPressed: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  menuCloseText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475467",
  },
  menuCloseTextPressed: {
    color: "#FFFFFF",
  },
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 24, 40, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  profileModalOverlayWithKeyboard: {
    justifyContent: "flex-end",
    paddingBottom: 24,
  },
  profileModalKeyboardContainer: {
    flex: 1,
  },
  profileModalCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 10,
  },
  profileModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#101828",
  },
  profileModalHint: {
    fontSize: 13,
    color: "#667085",
  },
  profileModalInput: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 10,
    backgroundColor: "#F9FAFB",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#101828",
    fontWeight: "600",
  },
  profileModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 2,
  },
  profileModalSecondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  profileModalSecondaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475467",
  },
  profileModalPrimaryBtn: {
    borderRadius: 10,
    backgroundColor: "#1570EF",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  profileModalPrimaryBtnDisabled: {
    backgroundColor: "#98A2B3",
  },
  profileModalPrimaryText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#FFFFFF",
  },
  languageRowPressed: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  languageText: {
    fontSize: 15,
    color: "#344054",
    fontWeight: "600",
  },
  languageTextPressed: {
    color: "#FFFFFF",
  },
  historyList: {
    maxHeight: 320,
  },
  historyCard: {
    borderWidth: 1,
    borderColor: "#EAECF0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#F9FAFB",
    gap: 3,
  },
  historyCardPressed: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  historyRestaurant: {
    fontSize: 14,
    color: "#101828",
    fontWeight: "700",
  },
  historyMetaRow: {
    flexDirection: "row",
    gap: 12,
  },
  historyDate: {
    fontSize: 13,
    color: "#101828",
    fontWeight: "700",
  },
  historyDatePressed: {
    color: "#FFFFFF",
  },
  historyMeta: {
    fontSize: 13,
    color: "#667085",
    fontWeight: "500",
  },
  historyMetaPressed: {
    color: "#EAF2FF",
  },
  emptyHistoryText: {
    fontSize: 14,
    color: "#667085",
    marginTop: 8,
    marginBottom: 12,
  },
  historyHint: {
    fontSize: 12,
    color: "#98A2B3",
    marginBottom: 6,
  },
  onboardingOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 24, 40, 0.7)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  onboardingCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DCE2EE",
    backgroundColor: "#FFFFFF",
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: "#101828",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  onboardingHeader: {
    alignItems: "center",
    gap: 4,
  },
  onboardingLogo: {
    width: 150,
    height: 34,
  },
  onboardingEyebrow: {
    fontSize: 12,
    color: "#475467",
    fontWeight: "600",
  },
  onboardingPagerViewport: {
    minHeight: 220,
  },
  onboardingPage: {
    paddingHorizontal: 6,
  },
  onboardingPageContent: {
    flex: 1,
    alignItems: "center",
  },
  onboardingIconWrap: {
    width: 108,
    height: 108,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(21, 112, 239, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(21, 112, 239, 0.2)",
    marginTop: 4,
    marginBottom: 12,
  },
  onboardingDualIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  onboardingTitleWrap: {
    minHeight: 56,
    justifyContent: "flex-start",
  },
  onboardingBodyWrap: {
    minHeight: 78,
    justifyContent: "flex-start",
  },
  onboardingPageTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: "#101828",
    textAlign: "center",
  },
  onboardingPageBody: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
    color: "#475467",
    textAlign: "center",
    paddingHorizontal: 12,
  },
  onboardingDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#D0D5DD",
  },
  onboardingDotActive: {
    width: 20,
    backgroundColor: "#1570EF",
  },
  onboardingActions: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  onboardingSecondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  onboardingSecondaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#667085",
  },
  onboardingPrimaryBtn: {
    borderRadius: 10,
    backgroundColor: "#1570EF",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  onboardingPrimaryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
