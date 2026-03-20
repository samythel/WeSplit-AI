import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Linking } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import ConfettiCannon from "react-native-confetti-cannon";

import {
  AlertTriangle,
  Camera,
  ChevronRight,
  ClipboardList,
  Hand,
  Info,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Share2,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react-native";
import { AIService } from "../services/AIService";
import { SpeechToTextService } from "../services/SpeechToTextService";
import { useAppState } from "../context/AppStateContext";
import { useI18n } from "../i18n/I18nProvider";
import { useSubscription } from "../context/SubscriptionContext";

import { Person, PERSON_COLORS, ReceiptItem } from "../types/billing";

interface CameraScreenProps {
  aiService: AIService;
  isDarkMode?: boolean;
}

const ASSIGN_QTY_ROW_HEIGHT = 36;
const ASSIGN_QTY_VISIBLE_ROWS = 5;

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

function allocateByWeight(totalCents: number, weights: number[]): number[] {
  if (totalCents <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const rawShares = safeWeights.map((weight) => (totalCents * weight) / totalWeight);
  const baseShares = rawShares.map((share) => Math.floor(share));
  let remainder = totalCents - baseShares.reduce((sum, share) => sum + share, 0);
  const order = rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    baseShares[order[index].index] += 1;
    remainder -= 1;
  }

  return baseShares;
}

function parseMoneyInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } | null {
  const normalized = hexColor.replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return { h: 0, s: 0, l };
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  h /= 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hue < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hue < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hue < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hue < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function makeVividTint(hexColor: string): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return hexColor;
  }
  const { h } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Vivid tint background — match the intensity of the unassigned orange (#FDE68A)
  const electric = hslToRgb(h, 0.9, 0.72);
  return `rgb(${electric.r}, ${electric.g}, ${electric.b})`;
}
function withAlpha(hexColor: string, alpha: number): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return hexColor;
  }
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${boundedAlpha})`;
}

// ── PersonRow ──────────────────────────────────────────────────────────────
interface PersonRowProps {
  person: Person;
  isDarkMode: boolean;
  isNameEditable: boolean;
  showDefaultNamePencil: boolean;
  isListening: boolean;
  isProcessing: boolean;
  canRemove: boolean;
  formatTotal: (v: number) => string;
  totalLabel: string;
  a11yMicLabel: string;
  a11yRemoveLabel: string;
  a11yDetailsLabel: string;
  onMicPress: () => void;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  onRowPress: () => void;
  t?: ReturnType<typeof useI18n>["t"];
}

function PersonRow({
  person,
  isDarkMode,
  isNameEditable,
  showDefaultNamePencil,
  isListening,
  isProcessing,
  canRemove,
  formatTotal,
  totalLabel,
  a11yMicLabel,
  a11yRemoveLabel,
  a11yDetailsLabel,
  onMicPress,
  onNameChange,
  onRemove,
  onRowPress,
  t: tFn,
}: PersonRowProps) {
  const hasTotal = person.grandTotal > 0;
  const palette = isDarkMode
    ? {
        borderSubtle: "#344054",
        borderStrong: "#475467",
        inputBg: "#182230",
        textPrimary: "#F2F4F7",
        textSecondary: "#D0D5DD",
        textMuted: "#98A2B3",
        chipBg: "#1F2A37",
        iconBtnBg: "#243241",
      }
    : {
        borderSubtle: "#F2F4F7",
        borderStrong: "#D0D5DD",
        inputBg: "#F8FAFC",
        textPrimary: "#101828",
        textSecondary: "#475467",
        textMuted: "#98A2B3",
        chipBg: "#F8FAFC",
        iconBtnBg: "#F2F4F7",
      };

  return (
    <View style={[rowStyles.row, { borderBottomColor: palette.borderSubtle }]}>
      {/* Name + total */}
      <View style={rowStyles.infoArea}>
        <View style={[rowStyles.nameInputWrap, { borderColor: person.color.fg, backgroundColor: isDarkMode ? withAlpha(person.color.fg, 0.5) : makeVividTint(person.color.fg) }]}>
          {showDefaultNamePencil ? <Pencil size={12} color={isDarkMode ? "#FFFFFF" : "#000000"} /> : null}
          <TextInput
            style={[
              rowStyles.nameInput,
              { color: isDarkMode ? "#FFFFFF" : "#000000", fontWeight: "700" },
              !isNameEditable && rowStyles.nameInputLocked,
              !isNameEditable && { color: isDarkMode ? "#FFFFFF" : "#000000" },
            ]}
            value={person.name}
            onChangeText={onNameChange}
            selectTextOnFocus={isNameEditable}
            editable={isNameEditable}
            placeholderTextColor={palette.textMuted}
          />
        </View>
        <View style={[rowStyles.totalRow, { borderColor: palette.borderStrong, backgroundColor: palette.chipBg }]}>
          <Text style={[rowStyles.totalLabel, { color: palette.textMuted }]}>{totalLabel}</Text>
          <Text style={[rowStyles.total, { color: palette.textMuted }, hasTotal && rowStyles.totalFilled]}>
            {hasTotal ? formatTotal(person.grandTotal) : "—"}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[
          rowStyles.micBtn,
          { backgroundColor: palette.iconBtnBg },
          isListening && rowStyles.micBtnActive,
        ]}
        onPress={(e) => { e.stopPropagation?.(); onMicPress(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={a11yMicLabel}
      >
        {isListening ? <Mic size={14} color="#F04438" /> : <Mic size={14} color={palette.textSecondary} />}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={(e) => { e.stopPropagation?.(); onRowPress(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[rowStyles.detailsBtn, { borderColor: palette.borderStrong, backgroundColor: palette.inputBg }]}
        accessibilityRole="button"
        accessibilityLabel={a11yDetailsLabel}
      >
        <ChevronRight size={16} color={palette.textMuted} />
      </TouchableOpacity>

      {canRemove && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onRemove(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={rowStyles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel={a11yRemoveLabel}
        >
          <X size={15} color={palette.textMuted} />
        </TouchableOpacity>
      )}
      {!canRemove && <View style={rowStyles.removeBtnPlaceholder} />}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F2F4F7",
  },
  infoArea: {
    flex: 1,
    gap: 6,
  },
  nameInputWrap: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nameInput: {
    flex: 1,
    fontSize: 15,
    color: "#101828",
    fontWeight: "600",
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  nameInputLocked: {
    color: "#475467",
  },
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 0,
  },
  micBtnActive: {
    backgroundColor: "#FEE4E2",
  },
  micIcon: { fontSize: 17 },
  detailsBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  totalRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E4E7EC",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 11,
    color: "#667085",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 1,
    paddingRight: 10,
  },
  total: {
    fontSize: 14,
    color: "#98A2B3",
    fontWeight: "600",
    marginLeft: 10,
    textAlign: "right",
  },
  totalFilled: {
    color: "#1570EF",
    fontSize: 16,
    fontWeight: "800",
  },
  removeBtn: { paddingHorizontal: 2 },
  removeBtnPlaceholder: {
    width: 19,
  },
  removeIcon: {
    color: "#98A2B3",
    fontSize: 14,
    fontWeight: "700",
  },
  personTipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
    paddingTop: 4,
  },
  personTipLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginRight: 2,
  },
  personTipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  personTipBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
});

// ── CaptureSheet ───────────────────────────────────────────────────────────
interface CaptureSheetProps {
  visible: boolean;
  onTakePhoto: () => void;
  onUpload: () => void;
  onClose: () => void;
  isDarkMode: boolean;
}

function CaptureSheet({ visible, onTakePhoto, onUpload, onClose, isDarkMode }: CaptureSheetProps) {
  const { t } = useI18n();
  const androidBottomInset = Platform.OS === "android"
    ? Math.max(0, Dimensions.get("screen").height - Dimensions.get("window").height)
    : 0;
  const bottomSheetInset = Platform.OS === "android" ? Math.max(44, androidBottomInset + 12) : 0;
  const colors = isDarkMode
    ? {
        sheet: "#182230",
        card: "#1F2A37",
        border: "#344054",
        textPrimary: "#F2F4F7",
        textSecondary: "#D0D5DD",
        overlay: "rgba(2, 6, 23, 0.76)",
      }
    : {
        sheet: "#FFFFFF",
        card: "#F9FAFB",
        border: "#EAECF0",
        textPrimary: "#101828",
        textSecondary: "#667085",
        overlay: "rgba(16, 24, 40, 0.55)",
      };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={captureStyles.modalRoot}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[captureStyles.backdrop, { backgroundColor: colors.overlay }]} />
        </TouchableWithoutFeedback>

        <View style={[captureStyles.sheet, { backgroundColor: colors.sheet, paddingBottom: 20 + bottomSheetInset }]}>
          <View style={[captureStyles.handle, { backgroundColor: colors.border }]} />

          <Text style={[captureStyles.title, { color: colors.textPrimary }]}>{t("capture.title")}</Text>
          <Text style={[captureStyles.subtitle, { color: colors.textSecondary }]}>{t("capture.subtitle")}</Text>

          {/* Take Photo option */}
          <TouchableOpacity
            style={[captureStyles.option, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onTakePhoto}
            activeOpacity={0.75}
          >
            <View style={[captureStyles.iconWrap, { backgroundColor: "#E8F1FB" }]}>
              <Camera size={28} color="#0960C3" />
            </View>
            <View style={captureStyles.optionBody}>
              <Text style={[captureStyles.optionTitle, { color: colors.textPrimary }]}>{t("capture.takePhoto")}</Text>
              <Text style={[captureStyles.optionDesc, { color: colors.textSecondary }]}>{t("capture.takePhoto.desc")}</Text>
            </View>
            <ChevronRight size={18} color="#D0D5DD" />
          </TouchableOpacity>

          {/* Upload from Library option */}
          <TouchableOpacity
            style={[captureStyles.option, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onUpload}
            activeOpacity={0.75}
          >
            <View style={[captureStyles.iconWrap, { backgroundColor: "#E8F1FB" }]}>
              <Upload size={28} color="#0960C3" />
            </View>
            <View style={captureStyles.optionBody}>
              <Text style={[captureStyles.optionTitle, { color: colors.textPrimary }]}>{t("capture.uploadLibrary")}</Text>
              <Text style={[captureStyles.optionDesc, { color: colors.textSecondary }]}>{t("capture.uploadLibrary.desc")}</Text>
            </View>
            <ChevronRight size={18} color="#D0D5DD" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[captureStyles.cancelBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[captureStyles.cancelText, { color: colors.textSecondary }]}>{t("capture.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const captureStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16, 24, 40, 0.55)",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
    overflow: "hidden",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D0D5DD",
    alignSelf: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#101828",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#667085",
    marginBottom: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#F9FAFB",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EAECF0",
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionBody: {
    flex: 1,
    gap: 3,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#101828",
  },
  optionDesc: {
    fontSize: 13,
    color: "#667085",
  },
  cancelBtn: {
    marginTop: 4,
    paddingVertical: 15,
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#667085",
  },
});

export function CameraScreen({ aiService, isDarkMode = false }: CameraScreenProps) {
  const {
    receiptAnalysis,
    setReceiptAnalysis,
    addHistoryEntry,
    receiptImageUri,
    setReceiptImageUri,
    persons,
    setPersons,
    updatePerson,
  } = useAppState();
  const { t, defaultCurrency } = useI18n();
  const { canScan, recordScan, scansRemaining } = useSubscription();
  const themeColors = useMemo(
    () =>
      isDarkMode
        ? {
            page: "#0B1220",
            surface: "#182230",
            surfaceAlt: "#1F2A37",
            border: "#344054",
            borderStrong: "#475467",
            textPrimary: "#F2F4F7",
            textSecondary: "#D0D5DD",
            textMuted: "#98A2B3",
            overlay: "rgba(2, 6, 23, 0.78)",
            inputBg: "#0F172A",
            dangerBg: "#3E1B1B",
            dangerBorder: "#7A271A",
            warningBg: "#3B2A0A",
            warningBorder: "#7A5D1A",
            warningText: "#FEC84B",
          }
        : {
            page: "transparent",
            surface: "#FFFFFF",
            surfaceAlt: "#F9FAFB",
            border: "#EAECF0",
            borderStrong: "#D0D5DD",
            textPrimary: "#101828",
            textSecondary: "#475467",
            textMuted: "#667085",
            overlay: "rgba(16, 24, 40, 0.56)",
            inputBg: "#FFFFFF",
            dangerBg: "#FEF2F2",
            dangerBorder: "#FECACA",
            warningBg: "#FFFAEB",
            warningBorder: "#FEC84B",
            warningText: "#92400E",
          },
    [isDarkMode],
  );
  const formatInputAmt = (value: number) => value.toFixed(2);
  const formatMoney = (value: number) => value.toFixed(2);
  const speechToTextService = useMemo(() => new SpeechToTextService(), []);

  // ── State ──────────────────────────────────────────────────────────────
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [micCanOpenSettings, setMicCanOpenSettings] = useState(false);
  const [listeningPersonId, setListeningPersonId] = useState<string | null>(null);
  const [processingPersonId, setProcessingPersonId] = useState<string | null>(null);
  const [voiceProgressStage, setVoiceProgressStage] = useState<"uploading" | "transcribing" | "matching" | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showCaptureSheet, setShowCaptureSheet] = useState(false);
  const [showScanReplaceConfirm, setShowScanReplaceConfirm] = useState(false);
  const [voiceClaimWarning, setVoiceClaimWarning] = useState<string | null>(null);
  const [pendingRemovePerson, setPendingRemovePerson] = useState<{ id: string; name: string } | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [analyzeCanRetry, setAnalyzeCanRetry] = useState(false);
  const [analyzeCanOpenSettings, setAnalyzeCanOpenSettings] = useState(false);
  const [lastAnalyzeUri, setLastAnalyzeUri] = useState<string | null>(null);
  const [ignoredItemIds, setIgnoredItemIds] = useState<string[]>([]);
  const [itemAssignments, setItemAssignments] = useState<Record<string, Record<string, number>>>({});
  const [expandedAssignmentItemId, setExpandedAssignmentItemId] = useState<string | null>(null);
  const [assignQtyTarget, setAssignQtyTarget] = useState<{ itemId: string; personId: string } | null>(null);
  const [assignQtyDraft, setAssignQtyDraft] = useState("1");
  const [assignQtyError, setAssignQtyError] = useState<string | null>(null);
  const [splitTargetItemId, setSplitTargetItemId] = useState<string | null>(null);
  const [splitPersonIds, setSplitPersonIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [splitCustomAmounts, setSplitCustomAmounts] = useState<Record<string, string>>({});
  const [splitValidationError, setSplitValidationError] = useState<string | null>(null);
  const [isSplitKeyboardVisible, setIsSplitKeyboardVisible] = useState(false);
  const [showAssignmentConfetti, setShowAssignmentConfetti] = useState(false);
  const [assignmentCelebrationBurstId, setAssignmentCelebrationBurstId] = useState(0);
  const [isFinalized, setIsFinalized] = useState(false);
  const [chargesReviewed, setChargesReviewed] = useState(false);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [chargeTaxDraft, setChargeTaxDraft] = useState("0.00");
  const [chargeTipDraft, setChargeTipDraft] = useState("0.00");
  const [tipMode, setTipMode] = useState<"receipt" | "individual">("receipt");
  const [personTipPcts, setPersonTipPcts] = useState<Record<string, number>>({});
  const [chargeServiceFeeDraft, setChargeServiceFeeDraft] = useState("0.00");
  const [showSummary, setShowSummary] = useState(false);
  const androidBottomInset = Platform.OS === "android"
    ? Math.max(0, Dimensions.get("screen").height - Dimensions.get("window").height)
    : 0;
  const bottomSheetInset = Platform.OS === "android" ? Math.max(44, androidBottomInset + 12) : 0;
  const [pendingVoiceMatch, setPendingVoiceMatch] = useState<{
    personId: string;
    personName: string;
    matchedItems: { name: string; qty: number }[];
    applyFn: () => void;
  } | null>(null);
  const [showVoiceTooltip, setShowVoiceTooltip] = useState(false);
  const hasShownVoiceTooltipRef = useRef(false);

  useEffect(() => {
    if (!isFinalized) {
      setFlowMessage(null);
    }
  }, [isFinalized]);

  // Show voice tooltip once after first receipt scan
  useEffect(() => {
    if (receiptAnalysis && !hasShownVoiceTooltipRef.current && persons.length >= 2) {
      hasShownVoiceTooltipRef.current = true;
      const timer = setTimeout(() => setShowVoiceTooltip(true), 800);
      return () => clearTimeout(timer);
    }
  }, [receiptAnalysis, persons.length]);

  useEffect(() => {
    if (!splitTargetItemId) {
      setIsSplitKeyboardVisible(false);
      return;
    }

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsSplitKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsSplitKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [splitTargetItemId]);

  // Refs to avoid stale-closure issues inside speech recognition event callbacks
  const listeningPersonRef = useRef<string | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const receiptAnalysisRef = useRef(receiptAnalysis);
  const personsRef = useRef(persons);
  const itemAssignmentsRef = useRef(itemAssignments);
  const assignmentCelebrationOpacity = useRef(new Animated.Value(0)).current;
  const assignmentCelebrationScale = useRef(new Animated.Value(0.92)).current;
  const assignmentCelebrationTranslateY = useRef(new Animated.Value(14)).current;
  const wasAllAssignedRef = useRef(false);
  const assignmentConfettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScrollRef = useRef<ScrollView | null>(null);
  const assignQtyScrollRef = useRef<ScrollView | null>(null);
  const peopleCardYRef = useRef<number | null>(null);
  const addPersonButtonYRef = useRef<number | null>(null);
  const scrollMainToBottomSoon = useCallback(() => {
    // Wait for the new row to render before scrolling.
    requestAnimationFrame(() => {
      setTimeout(() => {
        mainScrollRef.current?.scrollToEnd({ animated: true });
      }, 90);
    });
  }, []);
  const scrollToAddedPersonSoon = useCallback(() => {
    // Wait for list growth and layout pass, then keep focus around the people section.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const peopleCardY = peopleCardYRef.current;
        const addButtonY = addPersonButtonYRef.current;
        if (peopleCardY === null || addButtonY === null) {
          mainScrollRef.current?.scrollToEnd({ animated: true });
          return;
        }
        const absoluteAddButtonY = peopleCardY + addButtonY;
        const viewportHeight = Dimensions.get("window").height;
        const targetY = Math.max(0, Math.round(absoluteAddButtonY - viewportHeight * 0.45));
        mainScrollRef.current?.scrollTo({ y: targetY, animated: true });
      }, 110);
    });
  }, []);
  useEffect(() => { receiptAnalysisRef.current = receiptAnalysis; }, [receiptAnalysis]);
  useEffect(() => { personsRef.current = persons; }, [persons]);
  useEffect(() => { itemAssignmentsRef.current = itemAssignments; }, [itemAssignments]);
  useEffect(() => {
    setChargeTaxDraft(formatInputAmt(receiptAnalysis?.tax ?? 0));
    setChargeTipDraft(formatInputAmt(receiptAnalysis?.tip ?? 0));
    setChargeServiceFeeDraft(formatInputAmt(receiptAnalysis?.serviceFee ?? 0));
  }, [receiptAnalysis?.serviceFee, receiptAnalysis?.tax, receiptAnalysis?.tip]);

  // (Speech recognition events removed – Gladia handles everything in onMicPress)

  // ── Computed ───────────────────────────────────────────────────────────
  const grandTotal = receiptAnalysis
    ? tipMode === "individual"
      ? receiptAnalysis.subtotal + receiptAnalysis.tax + (receiptAnalysis.serviceFee ?? 0) + persons.reduce((sum, p) => {
          const pct = personTipPcts[p.id] ?? 0;
          return sum + Math.round(p.subtotal * pct) / 100;
        }, 0)
      : receiptAnalysis.subtotal + receiptAnalysis.tax + receiptAnalysis.tip + (receiptAnalysis.serviceFee ?? 0)
    : 0;
  const splitTotal = persons.reduce((sum, person) => sum + person.grandTotal, 0);

  const getItemAllocation = (
    item: ReceiptItem,
    existingPersons: Person[] = persons,
    assignments: Record<string, Record<string, number>> = itemAssignments,
  ) => {
    const rawAllocation = assignments[item.id];
    if (!rawAllocation) {
      const sameNameLineCount = (receiptAnalysis?.items ?? []).filter(
        (entry) => entry.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
      ).length;
      if (sameNameLineCount > 1) {
        return {} as Record<string, number>;
      }
      const fallbackOwner = existingPersons.find((person) => person.selectedItems.includes(item.name));
      if (!fallbackOwner) {
        return {} as Record<string, number>;
      }
      return { [fallbackOwner.id]: item.quantity };
    }

    const normalized: Record<string, number> = {};
    let remaining = item.quantity;
    for (const person of existingPersons) {
      if (remaining <= 0) break;
      const rawQty = Math.floor(rawAllocation[person.id] ?? 0);
      if (rawQty <= 0) continue;
      const nextQty = Math.min(rawQty, remaining);
      normalized[person.id] = nextQty;
      remaining -= nextQty;
    }
    return normalized;
  };

  const gapItems = (receiptAnalysis?.items ?? []).filter((item) => {
    if (ignoredItemIds.includes(item.id)) return false;
    const allocation = getItemAllocation(item);
    const assignedQty = Object.values(allocation).reduce((sum, qty) => sum + qty, 0);
    return assignedQty < item.quantity;
  });
  const leftToAssign = useMemo(() => {
    if (!receiptAnalysis) {
      return 0;
    }
    return receiptAnalysis.items.reduce((sum, item) => {
      if (ignoredItemIds.includes(item.id)) {
        return sum;
      }
      const allocation = getItemAllocation(item);
      const assignedQty = Object.values(allocation).reduce((allocated, qty) => allocated + qty, 0);
      const remainingQty = Math.max(0, item.quantity - assignedQty);
      return sum + (remainingQty * item.unitPrice);
    }, 0);
  }, [getItemAllocation, ignoredItemIds, receiptAnalysis]);
  const areAllItemsAssigned = Boolean(receiptAnalysis && receiptAnalysis.items.length > 0 && gapItems.length === 0);

  useEffect(() => {
    if (areAllItemsAssigned && !wasAllAssignedRef.current) {
      setFlowMessage(t("flow.step.assign.done"));
      setShowAssignmentConfetti(true);
      setAssignmentCelebrationBurstId((prev) => prev + 1);
      if (assignmentConfettiTimeoutRef.current) {
        clearTimeout(assignmentConfettiTimeoutRef.current);
      }
      assignmentConfettiTimeoutRef.current = setTimeout(() => {
        setShowAssignmentConfetti(false);
      }, 4200);
      assignmentCelebrationOpacity.setValue(0);
      assignmentCelebrationScale.setValue(0.92);
      assignmentCelebrationTranslateY.setValue(14);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(assignmentCelebrationOpacity, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(assignmentCelebrationScale, {
            toValue: 1,
            speed: 18,
            bounciness: 8,
            useNativeDriver: true,
          }),
          Animated.timing(assignmentCelebrationTranslateY, {
            toValue: 0,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(1700),
        Animated.parallel([
          Animated.timing(assignmentCelebrationOpacity, {
            toValue: 0,
            duration: 320,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(assignmentCelebrationScale, {
            toValue: 0.96,
            duration: 320,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start(({ finished }) => {
        if (finished) {
          setFlowMessage(null);
        }
      });
    }
    wasAllAssignedRef.current = areAllItemsAssigned;
  }, [
    areAllItemsAssigned,
    assignmentConfettiTimeoutRef,
    assignmentCelebrationOpacity,
    assignmentCelebrationScale,
    assignmentCelebrationTranslateY,
    t,
  ]);

  useEffect(
    () => () => {
      if (assignmentConfettiTimeoutRef.current) {
        clearTimeout(assignmentConfettiTimeoutRef.current);
      }
    },
    [],
  );

  const recalculatePeopleFromAnalysis = (
    analysis: NonNullable<typeof receiptAnalysis>,
    existingPersons: Person[],
    assignments: Record<string, Record<string, number>> = itemAssignments,
    currentTipMode: "receipt" | "individual" = tipMode,
    currentPersonTipPcts: Record<string, number> = personTipPcts,
  ) => {
    const subtotalCentsByPerson = existingPersons.map((person) =>
      analysis.items
        .reduce((sum, item) => {
          const allocation = getItemAllocation(item, existingPersons, assignments);
          const personQty = allocation[person.id] ?? 0;
          return sum + toCents(personQty * item.unitPrice);
        }, 0),
    );

    if (currentTipMode === "individual") {
      // Tax + service fee split proportionally; tip calculated per-person
      const taxFeesCents = toCents(analysis.tax + (analysis.serviceFee ?? 0));
      const taxFeeSharesCents = allocateByWeight(taxFeesCents, subtotalCentsByPerson);
      return existingPersons.map((person, index) => {
        const subtotal = fromCents(subtotalCentsByPerson[index]);
        const tipPct = currentPersonTipPcts[person.id] ?? 0;
        const personTipCents = Math.round(subtotalCentsByPerson[index] * tipPct / 100);
        const taxTipShare = fromCents(taxFeeSharesCents[index] + personTipCents);
        return {
          ...person,
          subtotal,
          taxTipShare,
          grandTotal: fromCents(subtotalCentsByPerson[index] + taxFeeSharesCents[index] + personTipCents),
        };
      });
    }

    // Receipt mode: tax + tip + fees all split proportionally
    const extrasCents = toCents(analysis.tax + analysis.tip + (analysis.serviceFee ?? 0));
    const extraSharesCents = allocateByWeight(extrasCents, subtotalCentsByPerson);
    return existingPersons.map((person, index) => {
      const subtotal = fromCents(subtotalCentsByPerson[index]);
      const taxTipShare = fromCents(extraSharesCents[index]);
      return {
        ...person,
        subtotal,
        taxTipShare,
        grandTotal: fromCents(subtotalCentsByPerson[index] + extraSharesCents[index]),
      };
    });
  };

  const dismissAnalyzeError = () => {
    setAnalyzeError(null);
    setAnalyzeCanRetry(false);
    setAnalyzeCanOpenSettings(false);
  };

  const dismissMicError = () => {
    setMicError(null);
    setMicCanOpenSettings(false);
  };

  const getLocalizedMicError = (
    err: unknown,
    fallback: "error.transcriptionFailed" | "error.recordingFailed",
  ): { message: string; canOpenSettings: boolean } => {
    const raw = typeof (err as { message?: unknown })?.message === "string"
      ? ((err as { message: string }).message || "").toLowerCase()
      : "";
    const isPermissionIssue = raw.includes("permission") || raw.includes("denied");
    if (isPermissionIssue) {
      return { message: t("error.micPermission"), canOpenSettings: true };
    }
    return { message: t(fallback), canOpenSettings: false };
  };

  const persistReceiptImage = async (sourceUri: string): Promise<string> => {
    if (!sourceUri?.trim()) {
      return sourceUri;
    }
    try {
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDir) {
        return sourceUri;
      }
      const receiptsDir = `${baseDir}receipt-images`;
      const dirInfo = await FileSystem.getInfoAsync(receiptsDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(receiptsDir, { intermediates: true });
      }
      const extMatch = sourceUri.match(/\.(jpg|jpeg|png|webp|heic|heif)(?:\?|$)/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
      const destinationUri = `${receiptsDir}/receipt-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
      await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
      return destinationUri;
    } catch {
      // If we fail to persist (e.g. permission/scoped URI edge case), keep the original URI.
      return sourceUri;
    }
  };

  // ── Handlers ───────────────────────────────────────────────────────────
  const onAnalyzeReceipt = async (imageUri: string) => {
    if (!imageUri?.trim()) {
      setAnalyzeError(t("error.uploadReceiptFirst"));
      setAnalyzeCanRetry(false);
      return;
    }

    if (!canScan) {
      setAnalyzeError(t("paywall.scanLimit.message", { limit: 5 }));
      setAnalyzeCanRetry(false);
      return;
    }

    const previousAnalysis = receiptAnalysisRef.current;
    if (previousAnalysis && previousAnalysis.items.length > 0) {
      addHistoryEntry(previousAnalysis);
    }

    // Clear current page state immediately when a new receipt is uploaded.
    setReceiptAnalysis(null);
    setReceiptImageUri(imageUri);
    setIgnoredItemIds([]);
    setItemAssignments({});
    setSelectedPersonId(null);
    setExpandedAssignmentItemId(null);
    setSplitTargetItemId(null);
    setAssignQtyTarget(null);
    setPersons((prev) =>
      prev.map((person) => ({
        ...person,
        voiceTranscript: "",
        selectedItems: [],
        subtotal: 0,
        taxTipShare: 0,
        grandTotal: 0,
      })),
    );

    setLastAnalyzeUri(imageUri);
    setIsAnalyzing(true);
    dismissAnalyzeError();
    try {
      const analysis = await aiService.analyzeReceipt(imageUri, defaultCurrency);
      setReceiptAnalysis(analysis);
      setReceiptImageUri(imageUri);
      setIgnoredItemIds([]);
      setItemAssignments({});
      // Auto-detect tip mode: if receipt has a tip, split proportionally; otherwise per-person
      setTipMode(analysis.tip > 0 ? "receipt" : "individual");
      setPersonTipPcts({});
      setPersons((prev) => {
        const cleared = prev.map((person) => ({
          ...person,
          voiceTranscript: "",
          selectedItems: [],
          subtotal: 0,
          taxTipShare: 0,
          grandTotal: 0,
        }));
        return recalculatePeopleFromAnalysis(analysis, cleared, {});
      });
      setSelectedPersonId(null);
      setExpandedAssignmentItemId(null);
      setIsFinalized(false);
      setChargesReviewed(false);
      setFlowMessage(null);
      recordScan();
    } catch (err: any) {
      console.warn("[CameraScreen.onAnalyzeReceipt] analyze failed", err);
      const isNonReceipt = (
        err?.message === "ERR_VISION_NO_ITEMS"
        || err?.message === "ERR_VISION_NON_RECEIPT"
      );
      const message = isNonReceipt ? t("error.nonReceiptDetected") : t("error.analysisFailed");
      setAnalyzeError(message);
      setAnalyzeCanRetry(!isNonReceipt);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const onTakePhoto = async () => {
    setShowScanReplaceConfirm(false);
    setShowCaptureSheet(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setAnalyzeError(t("error.cameraPermission"));
      setAnalyzeCanOpenSettings(true);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!result.canceled && result.assets.length) {
      const stableUri = await persistReceiptImage(result.assets[0].uri);
      await onAnalyzeReceipt(stableUri);
    }
  };

  const onPickFromGallery = async () => {
    setShowScanReplaceConfirm(false);
    setShowCaptureSheet(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAnalyzeError(t("error.galleryPermission"));
      setAnalyzeCanOpenSettings(true);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!result.canceled && result.assets.length) {
      const stableUri = await persistReceiptImage(result.assets[0].uri);
      await onAnalyzeReceipt(stableUri);
    }
  };

  const onCaptureReceipt = () => {
    const hasExistingWork = Boolean(
      receiptAnalysisRef.current ||
      receiptImageUri ||
      ignoredItemIds.length > 0 ||
      Object.keys(itemAssignmentsRef.current).length > 0,
    );
    if (!hasExistingWork) {
      setShowCaptureSheet(true);
      return;
    }
    setShowScanReplaceConfirm(true);
  };

  const onMicPress = async (personId: string) => {
    // If already recording for this person → stop, transcribe, and process
    if (listeningPersonRef.current === personId) {
      try {
        setListeningPersonId(null);
        setProcessingPersonId(personId);
        setVoiceProgressStage("uploading");
        updatePerson(personId, { voiceTranscript: t("voice.transcribing") });

        const transcript = await speechToTextService.stopAndTranscribe((stage) => {
          setVoiceProgressStage(stage);
        });
        currentTranscriptRef.current = transcript;
        updatePerson(personId, { voiceTranscript: transcript });

        const receipt = receiptAnalysisRef.current;
        if (transcript.trim() && receipt) {
          setVoiceProgressStage("matching");
          const share = await aiService.processVoiceSelection(transcript, receipt);
          const matchedItems = [...new Set(share.selected_items)];
          const matchedItemSet = new Set(matchedItems);
          const removeIntentPattern = /\b(remove|delete|without|except|minus|undo|take off|dont include|do not include)\b/i;
          const replaceIntentPattern = /\b(only|just)\b/i;
          const hasRemoveIntent = removeIntentPattern.test(transcript);
          const hasReplaceIntent = replaceIntentPattern.test(transcript);
          const hasExplicitCountMention = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(transcript);
          const requestedQuantitiesByItem: Record<string, number> = {};
          for (const [name, qty] of Object.entries(share.selected_item_quantities ?? {})) {
            const normalizedName = name.trim();
            const normalizedQty = Math.max(0, Math.floor(Number(qty)));
            if (!normalizedName || !Number.isFinite(normalizedQty) || normalizedQty <= 0) {
              continue;
            }
            requestedQuantitiesByItem[normalizedName] = normalizedQty;
          }

          // Build a preview of matched items for confirmation
          const previewItems: { name: string; qty: number }[] = [];
          for (const itemName of matchedItems) {
            const qty = requestedQuantitiesByItem[itemName] ?? 1;
            previewItems.push({ name: itemName, qty });
          }

          const applyVoiceMatches = () => {
            const currentReceipt = receiptAnalysisRef.current;
            if (!currentReceipt) return;
            const currentPersons = personsRef.current;
            const currentAssignments = itemAssignmentsRef.current;
            const voiceClaimConflicts: string[] = [];
            const nextAssignments: Record<string, Record<string, number>> = Object.fromEntries(
              Object.entries(currentAssignments).map(([itemId, allocation]) => [itemId, { ...allocation }]),
            );
            const clearPersonAssignmentForItem = (itemId: string) => {
              if (!nextAssignments[itemId]) return;
              delete nextAssignments[itemId][personId];
              if (Object.keys(nextAssignments[itemId]).length === 0) {
                delete nextAssignments[itemId];
              }
            };

            if (hasReplaceIntent) {
              currentReceipt.items.forEach((item) => clearPersonAssignmentForItem(item.id));
            }

            if (hasRemoveIntent) {
              currentReceipt.items.forEach((item) => {
                if (matchedItemSet.has(item.name)) {
                  clearPersonAssignmentForItem(item.id);
                }
              });
            } else {
              const remainingRequestedByName = { ...requestedQuantitiesByItem };
              currentReceipt.items.forEach((item) => {
                if (!matchedItemSet.has(item.name)) return;
                const allocation = nextAssignments[item.id] ?? {};
                const otherAssignedQty = Object.entries(allocation).reduce((sum, [id, qty]) => (
                  id === personId ? sum : sum + qty
                ), 0);
                const maxClaimableQty = Math.max(0, item.quantity - otherAssignedQty);
                const modelQty = remainingRequestedByName[item.name];
                const fallbackQty = item.quantity > 1 && hasExplicitCountMention ? 1 : item.quantity;
                const requestedQty = Math.max(1, Math.min(item.quantity, modelQty || fallbackQty));
                if (requestedQty > maxClaimableQty) {
                  const lineItemText = maxClaimableQty > 0
                    ? t("voice.claim.limit.detail.left", {
                      itemName: item.name,
                      requested: requestedQty,
                      available: maxClaimableQty,
                    })
                    : t("voice.claim.limit.detail.noneLeft", {
                      itemName: item.name,
                      requested: requestedQty,
                    });
                  voiceClaimConflicts.push(lineItemText);
                  return;
                }
                if (modelQty && modelQty > 0) {
                  remainingRequestedByName[item.name] = Math.max(0, modelQty - requestedQty);
                }
                const existingQty = allocation[personId] ?? 0;
                const resolvedQty = hasReplaceIntent ? requestedQty : Math.max(existingQty, requestedQty);
                nextAssignments[item.id] = { ...allocation, [personId]: Math.min(maxClaimableQty, resolvedQty) };
              });
            }

            const selectedItemsFromAssignments = [...new Set(
              currentReceipt.items
                .filter((item) => (nextAssignments[item.id]?.[personId] ?? 0) > 0)
                .map((item) => item.name),
            )];
            const updatedPersons = currentPersons.map((person) =>
              person.id === personId ? { ...person, selectedItems: selectedItemsFromAssignments } : person,
            );
            setItemAssignments(nextAssignments);
            setPersons(recalculatePeopleFromAnalysis(currentReceipt, updatedPersons, nextAssignments));
            setIgnoredItemIds((prev) => prev.filter((id) => {
              const item = currentReceipt?.items.find((entry) => entry.id === id);
              return item ? !selectedItemsFromAssignments.includes(item.name) : true;
            }));
            if (voiceClaimConflicts.length > 0) {
              const first = voiceClaimConflicts[0];
              const moreCount = voiceClaimConflicts.length - 1;
              setVoiceClaimWarning(
                moreCount > 0
                  ? t("voice.claim.limit.summaryWithMore", { detail: first, count: moreCount })
                  : t("voice.claim.limit.summary", { detail: first }),
              );
            }
            setIsFinalized(false);
          };

          // Show confirmation modal instead of applying directly
          const personName = personsRef.current.find((p) => p.id === personId)?.name ?? "";
          if (previewItems.length > 0) {
            setPendingVoiceMatch({
              personId,
              personName,
              matchedItems: previewItems,
              applyFn: applyVoiceMatches,
            });
          } else {
            // No matches — show info but don't block
            setPendingVoiceMatch({
              personId,
              personName,
              matchedItems: [],
              applyFn: () => {},
            });
          }
        }
      } catch (err: any) {
        const resolved = getLocalizedMicError(err, "error.transcriptionFailed");
        setMicError(resolved.message);
        setMicCanOpenSettings(resolved.canOpenSettings);
      } finally {
        listeningPersonRef.current = null;
        currentTranscriptRef.current = "";
        setProcessingPersonId(null);
        setVoiceProgressStage(null);
      }
      return;
    }

    // Stop any other active recording first
    if (listeningPersonRef.current) {
      speechToTextService.cancel();
      listeningPersonRef.current = null;
      setListeningPersonId(null);
    }

    if (!receiptAnalysis) {
      setAnalyzeError(t("error.snapReceiptFirst"));
      return;
    }
    dismissAnalyzeError();
    dismissMicError();

    const hasPermission = await speechToTextService.requestPermissions();
    if (!hasPermission) {
      setMicError(t("error.micPermission"));
      setMicCanOpenSettings(true);
      return;
    }

    // Start recording
    try {
      listeningPersonRef.current = personId;
      currentTranscriptRef.current = "";
      updatePerson(personId, { voiceTranscript: "" });
      await speechToTextService.startRecording();
      setListeningPersonId(personId);
      setIsFinalized(false);
      setFlowMessage(null);
    } catch (err: any) {
      listeningPersonRef.current = null;
      const resolved = getLocalizedMicError(err, "error.recordingFailed");
      setMicError(resolved.message);
      setMicCanOpenSettings(resolved.canOpenSettings);
    }
  };

  const onAddPerson = () => {
    setPersons((prevPersons) => {
      const usedDefaultNumbers = new Set<number>([1]);
      for (const person of prevPersons) {
        for (let index = 1; index <= prevPersons.length + 1; index += 1) {
          if (person.name === t("person.defaultName", { n: index })) {
            usedDefaultNumbers.add(index);
            break;
          }
        }
      }

      let nextPersonNumber = 1;
      while (usedDefaultNumbers.has(nextPersonNumber)) {
        nextPersonNumber += 1;
      }

      const next: Person = {
        id: `person-${Date.now()}-${nextPersonNumber}`,
        name: t("person.defaultName", { n: nextPersonNumber }),
        color: PERSON_COLORS[prevPersons.length % PERSON_COLORS.length],
        voiceTranscript: "",
        selectedItems: [],
        subtotal: 0,
        taxTipShare: 0,
        grandTotal: 0,
      };

      return [...prevPersons, next];
    });
    setIsFinalized(false);
    setFlowMessage(null);
    scrollToAddedPersonSoon();
  };

  const removePersonById = (personId: string) => {
    if (!receiptAnalysis) {
      setPersons(persons.filter((p) => p.id !== personId));
      return;
    }
    const nextPersons = persons.filter((p) => p.id !== personId);
    const nextAssignments = Object.fromEntries(
      Object.entries(itemAssignments).map(([itemId, allocation]) => [
        itemId,
        Object.fromEntries(Object.entries(allocation).filter(([id]) => id !== personId)),
      ]),
    );
    setItemAssignments(nextAssignments);
    setPersons(recalculatePeopleFromAnalysis(receiptAnalysis, nextPersons, nextAssignments));
    setIsFinalized(false);
    setFlowMessage(null);
  };

  const onRemovePerson = (personId: string) => {
    const personToRemove = persons.find((entry) => entry.id === personId);
    if (!personToRemove) {
      return;
    }
    setPendingRemovePerson({ id: personToRemove.id, name: personToRemove.name });
  };

  const onOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      // No-op if the platform cannot open settings directly.
    }
  };

  const updateChargeField = (field: "tax" | "tip" | "serviceFee", text: string) => {
    if (!receiptAnalysis) return;
    const parsed = parseMoneyInput(text);
    if (parsed === null) {
      // Keep UX quiet for charge typos: reset to last valid values.
      setChargeTaxDraft(formatInputAmt(receiptAnalysis.tax));
      setChargeTipDraft(formatInputAmt(receiptAnalysis.tip));
      setChargeServiceFeeDraft(formatInputAmt(receiptAnalysis.serviceFee ?? 0));
      return;
    }
    setInputError(null);
    const updated = { ...receiptAnalysis, [field]: parsed };
    setReceiptAnalysis(updated);
    setPersons(recalculatePeopleFromAnalysis(updated, persons));
    setChargesReviewed(true);
    setIsFinalized(false);
  };

  const selectedPerson = persons.find((p) => p.id === selectedPersonId) ?? null;
  const listeningPerson = persons.find((person) => person.id === listeningPersonId) ?? null;
  const processingPerson = persons.find((person) => person.id === processingPersonId) ?? null;
  const isVoiceBusy = Boolean(listeningPerson || processingPerson);
  const voiceProcessingStatus = processingPerson
    ? (voiceProgressStage === "uploading"
      ? t("voice.progress.uploading")
      : voiceProgressStage === "transcribing"
        ? t("voice.progress.transcribing")
        : t("voice.progress.matching"))
    : "";
  const voiceOverlayTitle = listeningPerson
    ? t("voice.listeningFor", { name: listeningPerson.name })
    : voiceProcessingStatus;
  const voiceOverlayHint = listeningPerson ? t("voice.tapToStop") : (processingPerson?.name ?? "");
  const isDefaultPersonName = useCallback((name: string) => {
    for (let index = 1; index <= persons.length + 1; index += 1) {
      if (name === t("person.defaultName", { n: index })) {
        return true;
      }
    }
    return false;
  }, [persons.length, t]);
  const splitTargetItem = receiptAnalysis?.items.find((item) => item.id === splitTargetItemId) ?? null;
  const splitSelectedPeople = useMemo(
    () => persons.filter((person) => splitPersonIds.includes(person.id)),
    [persons, splitPersonIds],
  );
  const splitTargetTotalCents = splitTargetItem ? toCents(splitTargetItem.quantity * splitTargetItem.unitPrice) : 0;
  const customSplitStatus = useMemo(() => {
    if (splitMode !== "custom" || !splitTargetItem) {
      return {
        hasInvalidValues: false,
        sumCents: 0,
        isSumCorrect: false,
      };
    }
    let hasInvalidValues = false;
    let sumCents = 0;
    for (const person of splitSelectedPeople) {
      const parsed = parseMoneyInput(splitCustomAmounts[person.id] ?? "");
      if (parsed === null) {
        hasInvalidValues = true;
        continue;
      }
      sumCents += toCents(parsed);
    }
    return {
      hasInvalidValues,
      sumCents,
      isSumCorrect: splitSelectedPeople.length > 0 && !hasInvalidValues && sumCents === splitTargetTotalCents,
    };
  }, [splitCustomAmounts, splitMode, splitSelectedPeople, splitTargetItem, splitTargetTotalCents]);
  const assignQtyTargetItem = receiptAnalysis?.items.find((item) => item.id === assignQtyTarget?.itemId) ?? null;
  const assignQtyOptions = useMemo(() => {
    const maxQty = assignQtyTargetItem?.quantity ?? 1;
    return Array.from({ length: maxQty + 1 }, (_, index) => String(index));
  }, [assignQtyTargetItem?.quantity]);
  const selectAssignQty = (value: string, animated = true) => {
    const optionIndex = assignQtyOptions.indexOf(value);
    const nextIndex = optionIndex >= 0 ? optionIndex : 0;
    const nextValue = assignQtyOptions[nextIndex] ?? "1";
    setAssignQtyDraft(nextValue);
    assignQtyScrollRef.current?.scrollTo({
      y: nextIndex * ASSIGN_QTY_ROW_HEIGHT,
      animated,
    });
  };
  useEffect(() => {
    if (!assignQtyTargetItem || !assignQtyTarget) return;
    const parsedQty = Number.parseInt(assignQtyDraft, 10);
    const safeQty = Number.isNaN(parsedQty)
      ? 1
      : Math.max(0, Math.min(assignQtyTargetItem.quantity, parsedQty));
    requestAnimationFrame(() => selectAssignQty(String(safeQty), false));
  }, [assignQtyTargetItem, assignQtyTarget]);

  const applyAssignmentForItem = (item: ReceiptItem, personId: string, requestedQty: number) => {
    if (!receiptAnalysis) return { ok: false, error: t("camera.assign.error.missingReceiptData") };
    const allocation = getItemAllocation(item);
    if (item.quantity === 1) {
      const nextAssignments = { ...itemAssignments, [item.id]: { [personId]: requestedQty > 0 ? 1 : 0 } };
      if (requestedQty <= 0) {
        delete nextAssignments[item.id];
      }
      setItemAssignments(nextAssignments);
      const updatedPersons = persons.map((person) => {
        const selectedWithoutItem = person.selectedItems.filter((name) => name !== item.name);
        return person.id === personId && requestedQty > 0
          ? { ...person, selectedItems: [...selectedWithoutItem, item.name] }
          : { ...person, selectedItems: selectedWithoutItem };
      });
      setPersons(recalculatePeopleFromAnalysis(receiptAnalysis, updatedPersons, nextAssignments));
      if (requestedQty > 0) {
        setIgnoredItemIds((prev) => prev.filter((id) => id !== item.id));
      }
      setIsFinalized(false);
      return { ok: true as const };
    }

    const otherTotal = Object.entries(allocation).reduce((sum, [id, qty]) => (
      id === personId ? sum : sum + qty
    ), 0);
    if (requestedQty < 0) {
      return { ok: false, error: t("camera.assign.error.negativeQuantity") };
    }
    if (otherTotal + requestedQty > item.quantity) {
      return {
        ok: false,
        error: t("camera.assign.error.quantityLeft", { count: item.quantity - otherTotal }),
      };
    }

    const nextAllocation = { ...allocation };
    if (requestedQty === 0) {
      delete nextAllocation[personId];
    } else {
      nextAllocation[personId] = requestedQty;
    }
    const nextAssignments = { ...itemAssignments, [item.id]: nextAllocation };
    if (Object.keys(nextAllocation).length === 0) {
      delete nextAssignments[item.id];
    }

    setItemAssignments(nextAssignments);
    const updatedPersons = persons.map((person) => {
      const isAssigned = (nextAllocation[person.id] ?? 0) > 0;
      const selectedWithoutItem = person.selectedItems.filter((name) => name !== item.name);
      return isAssigned
        ? { ...person, selectedItems: [...selectedWithoutItem, item.name] }
        : { ...person, selectedItems: selectedWithoutItem };
    });
    setPersons(recalculatePeopleFromAnalysis(receiptAnalysis, updatedPersons, nextAssignments));
    if (Object.keys(nextAllocation).length > 0) {
      setIgnoredItemIds((prev) => prev.filter((id) => id !== item.id));
    }
    setIsFinalized(false);
    return { ok: true as const };
  };

  const openAssignQuantityModal = (item: ReceiptItem, personId: string) => {
    const currentQty = getItemAllocation(item)[personId] ?? 0;
    setAssignQtyTarget({ itemId: item.id, personId });
    setAssignQtyDraft(String(currentQty || 1));
    setAssignQtyError(null);
  };

  const closeAssignQuantityModal = () => {
    setAssignQtyTarget(null);
    setAssignQtyError(null);
  };

  const confirmAssignQuantity = () => {
    if (!assignQtyTarget || !assignQtyTargetItem) return;
    const parsedQty = Number.parseInt(assignQtyDraft, 10);
    if (Number.isNaN(parsedQty)) {
      setAssignQtyError(t("camera.assign.error.validWholeNumber"));
      return;
    }
    const result = applyAssignmentForItem(assignQtyTargetItem, assignQtyTarget.personId, parsedQty);
    if (!result.ok) {
      setAssignQtyError(result.error);
      return;
    }
    closeAssignQuantityModal();
    setExpandedAssignmentItemId(null);
  };

  const openSplitModal = (itemId: string) => {
    setSplitTargetItemId(itemId);
    setSplitPersonIds([]);
    setSplitMode("equal");
    setSplitCustomAmounts({});
    setSplitValidationError(null);
  };

  const closeSplitModal = () => {
    setSplitTargetItemId(null);
    setSplitValidationError(null);
  };

  const applySplitForItem = () => {
    if (!receiptAnalysis || !splitTargetItem || splitPersonIds.length === 0) {
      setSplitValidationError(t("camera.split.error.selectPerson"));
      return;
    }

    const selectedIdSet = new Set(splitPersonIds.filter((id) => persons.some((person) => person.id === id)));
    const selectedPeople = splitSelectedPeople.filter((person) => selectedIdSet.has(person.id));
    if (selectedPeople.length === 0) {
      setSplitValidationError(t("camera.split.error.selectPerson"));
      return;
    }
    if (splitMode === "equal" && selectedIdSet.size < 2) {
      setSplitValidationError(t("camera.split.error.equalRequiresTwo"));
      return;
    }

    const itemTotalCents = toCents(splitTargetItem.quantity * splitTargetItem.unitPrice);

    let splitItems: { id: string; name: string; quantity: number; unitPrice: number }[] = [];
    if (splitMode === "equal") {
      const allocatedCents = allocateByWeight(itemTotalCents, selectedPeople.map(() => 1));
      splitItems = selectedPeople.map((person, index) => {
        return {
          id: `${splitTargetItem.id}-split-${person.id}`,
          name: `${splitTargetItem.name} (${person.name})`,
          quantity: 1,
          unitPrice: fromCents(allocatedCents[index]),
        };
      });
    } else {
      const customValues = selectedPeople.map((person) => parseMoneyInput(splitCustomAmounts[person.id] ?? ""));
      if (customValues.some((value) => value === null)) {
        setSplitValidationError(
          `${t("camera.split.error.validAmounts")} ${t("camera.split.error.totalMismatch", {
            total: formatMoney(fromCents(itemTotalCents)),
          })}`,
        );
        return;
      }
      const customValuesCents = customValues.map((value) => toCents(value ?? 0));
      const customTotalCents = customValuesCents.reduce((sum, value) => sum + value, 0);
      if (customTotalCents !== itemTotalCents) {
        setSplitValidationError(
          t("camera.split.error.totalMismatch", {
            total: formatMoney(fromCents(itemTotalCents)),
          }),
        );
        return;
      }
      splitItems = selectedPeople.map((person, index) => ({
        id: `${splitTargetItem.id}-split-${person.id}`,
        name: `${splitTargetItem.name} (${person.name})`,
        quantity: 1,
        unitPrice: fromCents(customValuesCents[index]),
      }));
    }

    const remainingItems = receiptAnalysis.items.filter((entry) => entry.id !== splitTargetItem.id);
    const updatedItems = [...remainingItems, ...splitItems];
    const updatedAnalysis = {
      ...receiptAnalysis,
      items: updatedItems,
      subtotal: fromCents(updatedItems.reduce((sum, entry) => sum + toCents(entry.quantity * entry.unitPrice), 0)),
    };
    const updatedPersons = persons.map((person) => {
      const splitItem = splitItems.find((entry) => entry.id.endsWith(person.id));
      const selectedWithoutOriginal = person.selectedItems.filter((entry) => entry !== splitTargetItem.name);
      if (!splitItem) {
        return { ...person, selectedItems: selectedWithoutOriginal };
      }
      return {
        ...person,
        selectedItems: [...selectedWithoutOriginal, splitItem.name],
      };
    });

    setReceiptAnalysis(updatedAnalysis);
    const nextAssignments = { ...itemAssignments };
    delete nextAssignments[splitTargetItem.id];
    setItemAssignments(nextAssignments);
    setPersons(recalculatePeopleFromAnalysis(updatedAnalysis, updatedPersons, nextAssignments));
    setIgnoredItemIds((prev) => prev.filter((id) => id !== splitTargetItem.id));
    setExpandedAssignmentItemId(null);
    closeSplitModal();
    setIsFinalized(false);
  };

  const deleteItemById = (itemId: string) => {
    if (!receiptAnalysis) return;
    const targetItem = receiptAnalysis.items.find((entry) => entry.id === itemId);
    if (!targetItem) return;

    const updatedItems = receiptAnalysis.items.filter((entry) => entry.id !== itemId);
    const newSubtotal = fromCents(
      updatedItems.reduce((sum, entry) => sum + toCents(entry.quantity * entry.unitPrice), 0),
    );
    const updatedAnalysis = { ...receiptAnalysis, items: updatedItems, subtotal: newSubtotal };

    const nextAssignments = { ...itemAssignments };
    delete nextAssignments[itemId];

    const updatedPersons = persons.map((person) => ({
      ...person,
      selectedItems: person.selectedItems.filter((selected) => selected !== targetItem.name),
    }));

    setReceiptAnalysis(updatedAnalysis);
    setItemAssignments(nextAssignments);
    setPersons(recalculatePeopleFromAnalysis(updatedAnalysis, updatedPersons, nextAssignments));
    setIgnoredItemIds((prev) => prev.filter((id) => id !== itemId));
    setExpandedAssignmentItemId((prev) => (prev === itemId ? null : prev));
    setSplitTargetItemId((prev) => (prev === itemId ? null : prev));
    setAssignQtyTarget((prev) => (prev?.itemId === itemId ? null : prev));
    setIsFinalized(false);
    setFlowMessage(null);
  };

  return (
    <View style={[styles.root, { backgroundColor: themeColors.page }]}>
    <KeyboardAvoidingView
      style={styles.screenKeyboardContainer}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
    >
    <ScrollView
      ref={mainScrollRef}
      style={styles.scrollView}
      contentContainerStyle={[styles.container, { paddingBottom: 32 + bottomSheetInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Receipt area ── */}
      <TouchableOpacity
        style={[styles.receiptArea, { borderColor: themeColors.borderStrong, backgroundColor: themeColors.surfaceAlt }]}
        onPress={onCaptureReceipt}
        disabled={isAnalyzing}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t("capture.title")}
      >
        {receiptImageUri ? (
          <View style={styles.receiptPreviewWrap}>
            <Image source={{ uri: receiptImageUri }} style={styles.receiptPreview} resizeMode="cover" />
            {isAnalyzing ? (
              <View style={styles.receiptAnalyzingOverlay}>
                <ActivityIndicator size="large" color="#1570EF" />
                <Text style={[styles.receiptHint, { color: "#FFFFFF" }]}>{t("receipt.analyzing")}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.receiptPlaceholder}>
            <View style={styles.receiptIconRow}>
              <Camera size={36} color={themeColors.textMuted} />
              <Upload size={36} color={themeColors.textMuted} />
            </View>
            <Text style={[styles.receiptHint, { color: themeColors.textMuted }]}>{t("receipt.tapToSnap")}</Text>
          </View>
        )}
      </TouchableOpacity>
      {receiptImageUri && !isAnalyzing ? (
        <TouchableOpacity
          style={[styles.receiptActionBtn, { borderColor: themeColors.borderStrong, backgroundColor: themeColors.surface }]}
          onPress={onCaptureReceipt}
          accessibilityRole="button"
          accessibilityLabel={t("receipt.scanNew")}
        >
          <Camera size={16} color={themeColors.textSecondary} />
          <Text style={[styles.receiptActionText, { color: themeColors.textSecondary }]}>{t("receipt.scanNew")}</Text>
        </TouchableOpacity>
      ) : null}

      {analyzeError ? (
        <View style={[styles.errorCard, { borderColor: themeColors.dangerBorder, backgroundColor: themeColors.dangerBg }]}>
          <Text style={styles.errorText}>{analyzeError}</Text>
          <View style={styles.errorActions}>
            {analyzeCanRetry && lastAnalyzeUri ? (
              <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={() => onAnalyzeReceipt(lastAnalyzeUri)}>
                <Text style={styles.errorActionText}>{t("error.action.retry")}</Text>
              </TouchableOpacity>
            ) : null}
            {analyzeCanOpenSettings ? (
              <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={onOpenSettings}>
                <Text style={styles.errorActionText}>{t("error.action.openSettings")}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={dismissAnalyzeError}>
              <Text style={styles.errorActionText}>{t("error.action.dismiss")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {micError ? (
        <View style={[styles.errorCard, { borderColor: themeColors.dangerBorder, backgroundColor: themeColors.dangerBg }]}>
          <Text style={styles.micErrorText}>{micError}</Text>
          <View style={styles.errorActions}>
            {micCanOpenSettings ? (
              <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={onOpenSettings}>
                <Text style={styles.errorActionText}>{t("error.action.openSettings")}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={dismissMicError}>
              <Text style={styles.errorActionText}>{t("error.action.dismiss")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {inputError ? (
        <View style={[styles.errorCard, { borderColor: themeColors.dangerBorder, backgroundColor: themeColors.dangerBg }]}>
          <Text style={styles.errorText}>{inputError}</Text>
          <View style={styles.errorActions}>
            <TouchableOpacity style={[styles.errorActionBtn, { backgroundColor: themeColors.surface, borderColor: themeColors.dangerBorder }]} onPress={() => setInputError(null)}>
              <Text style={styles.errorActionText}>{t("error.action.dismiss")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {/* ── People section ── */}
      <View
        style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
        onLayout={(event) => {
          peopleCardYRef.current = event.nativeEvent.layout.y;
        }}
      >
        <Text style={[styles.cardTitle, { color: themeColors.textMuted }]}>{t("person.splitBetween")}</Text>

        {persons.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            isDarkMode={isDarkMode}
            isNameEditable={person.id !== "person-1"}
            showDefaultNamePencil={person.id !== "person-1" && isDefaultPersonName(person.name)}
            isListening={listeningPersonId === person.id}
            isProcessing={processingPersonId === person.id}
            canRemove={persons.length > 1 && person.id !== "person-1"}
            formatTotal={(value) => formatMoney(value)}
            totalLabel={t("detail.total")}
            a11yMicLabel={t("camera.a11y.personMicrophone", { name: person.name })}
            a11yDetailsLabel={t("camera.a11y.viewPersonDetails", { name: person.name })}
            a11yRemoveLabel={t("camera.a11y.removePerson", { name: person.name })}
            onMicPress={() => onMicPress(person.id)}
            onNameChange={(name) => {
              updatePerson(person.id, { name });
              setIsFinalized(false);
            }}
            onRemove={() => {
              if (person.id === "person-1") return;
              onRemovePerson(person.id);
            }}
            onRowPress={() => setSelectedPersonId(person.id)}
            t={t}
          />
        ))}

        <TouchableOpacity
          style={[styles.addPersonBtn, { borderColor: themeColors.borderStrong }]}
          onPress={onAddPerson}
          onLayout={(event) => {
            addPersonButtonYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <Plus size={15} color={themeColors.textSecondary} />
          <Text style={[styles.addPersonText, { color: themeColors.textSecondary }]}>{t("person.addPerson")}</Text>
        </TouchableOpacity>
        <View style={[styles.splitTotalRow, { borderTopColor: themeColors.border }]}>
          <Text style={[styles.splitTotalLabel, { color: themeColors.textMuted }]}>{t("split.total")}</Text>
          <Text style={[styles.splitTotalValue, { color: themeColors.textPrimary }]}>{formatMoney(splitTotal)}</Text>
        </View>
      </View>

      {/* ── Charges ── */}
      {receiptAnalysis && (
        <View style={[styles.chargesCard, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]}>
          <Text style={[styles.chargesTitle, { color: themeColors.textSecondary }]}>{t("charges.title")}</Text>

          {/* Food & drinks subtotal (from receipt line items) */}
          <View style={[styles.chargeRow, { borderBottomWidth: 1, borderBottomColor: themeColors.border, paddingBottom: 10, marginBottom: 6 }]}>
            <Text style={[styles.chargeLabel, { fontWeight: "700", color: themeColors.textSecondary }]}>
              {`${t("charges.subtotal")} (${t("receipt.items")})`}
            </Text>
            <Text style={[styles.chargeInput, { color: themeColors.textSecondary, fontWeight: "700", backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong }]}>
              {formatMoney(receiptAnalysis.subtotal)}
            </Text>
          </View>

          {/* Tax */}
          <View style={styles.chargeRow}>
            <Text style={[styles.chargeLabel, { color: themeColors.textMuted }]}>{t("charges.tax")}</Text>
            <TextInput
              style={[styles.chargeInput, { color: themeColors.textSecondary, backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong }]}
              value={chargeTaxDraft}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel={t("charges.tax")}
              onChangeText={setChargeTaxDraft}
              onEndEditing={() => updateChargeField("tax", chargeTaxDraft)}
            />
          </View>

          {/* Service Fee */}
          <View style={styles.chargeRow}>
            <Text style={[styles.chargeLabel, { color: themeColors.textMuted }]}>{t("charges.serviceFee")}</Text>
            <TextInput
              style={[styles.chargeInput, { color: themeColors.textSecondary, backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong }]}
              value={chargeServiceFeeDraft}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel={t("charges.serviceFee")}
              onChangeText={setChargeServiceFeeDraft}
              onEndEditing={() => updateChargeField("serviceFee", chargeServiceFeeDraft)}
            />
          </View>

          {/* Tip from receipt (read-only display) */}
          {receiptAnalysis && receiptAnalysis.tip > 0 && (
            <View style={styles.chargeRow}>
              <Text style={[styles.chargeLabel, { color: themeColors.textMuted }]}>{t("charges.tip")}</Text>
              <Text style={[styles.chargeLabel, { color: themeColors.textSecondary }]}>{formatInputAmt(receiptAnalysis.tip)}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Grand total ── */}
      {receiptAnalysis && (
        <View style={styles.grandTotalCard}>
          <Text style={styles.grandTotalLabel}>{t("charges.grandTotal")}</Text>
          <Text style={styles.grandTotalValue}>{formatMoney(grandTotal)}</Text>
        </View>
      )}

      {receiptAnalysis ? (
        <View style={[styles.leftToAssignCard, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.borderStrong }]}>
          <View style={styles.leftToAssignHeader}>
            <Text style={[styles.leftToAssignLabel, { color: themeColors.textSecondary }]}>{t("receipt.leftToAssign")}</Text>
            <Text style={styles.leftToAssignValue}>{formatMoney(leftToAssign)}</Text>
          </View>
          <Text style={[styles.leftToAssignHint, { color: themeColors.textMuted }]}>
            {gapItems.length === 1
              ? t("receipt.leftToAssignHintSingular", { count: gapItems.length })
              : t("receipt.leftToAssignHintPlural", { count: gapItems.length })}
          </Text>
        </View>
      ) : null}

      {/* ── Color-coded receipt items ── */}
      {receiptAnalysis && receiptAnalysis.items.length > 0 && (
        <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <Text style={[styles.cardTitle, { color: themeColors.textMuted }]}>{t("receipt.items")}</Text>
          {gapItems.length > 0 ? (
            <View style={[styles.inlineGapBanner, { borderColor: themeColors.warningBorder, backgroundColor: themeColors.warningBg }]}>
              <AlertTriangle size={14} color="#B54708" />
              <Text style={[styles.inlineGapBannerText, { color: themeColors.warningText }]}>
                {gapItems.length === 1
                  ? t("receipt.unassignedSingular", { count: gapItems.length })
                  : t("receipt.unassignedPlural", { count: gapItems.length })}
              </Text>
            </View>
          ) : null}
          {receiptAnalysis.items.map((item) => {
            const allocation = getItemAllocation(item);
            const ownerSegments = persons
              .map((person) => ({ person, qty: allocation[person.id] ?? 0 }))
              .filter((entry) => entry.qty > 0);
            const splitOwnerId = item.id.includes("-split-") ? item.id.split("-split-")[1] : null;
            const splitOwner = splitOwnerId ? persons.find((person) => person.id === splitOwnerId) ?? null : null;
            const owner = splitOwner ?? (ownerSegments.length === 1 ? ownerSegments[0].person : null);
            const hasSharedOwners = !splitOwner && ownerSegments.length > 1;
            const assignedQty = ownerSegments.reduce((sum, entry) => sum + entry.qty, 0);
            const isIgnored = ignoredItemIds.includes(item.id);
            const isPartiallyAssigned = assignedQty > 0 && assignedQty < item.quantity;
            const isAssignmentOpen = assignedQty === 0 || isPartiallyAssigned || expandedAssignmentItemId === item.id;
            const splitOwnerSuffix = splitOwner ? ` (${splitOwner.name})` : "";
            const itemDisplayName = splitOwnerSuffix && item.name.endsWith(splitOwnerSuffix)
              ? item.name.slice(0, -splitOwnerSuffix.length)
              : item.name;
            const isEditableManualItem = item.id.startsWith("manual-item-") && !item.id.includes("-split-");
            const isOwned = !!(owner && !hasSharedOwners);
            const ownedTextColor = undefined;
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.92}
                onPress={() => {
                  if (ownerSegments.length === 0 && !splitOwner) return;
                  setExpandedAssignmentItemId((prev) => (prev === item.id ? null : item.id));
                }}
                style={[
                  styles.itemCard,
                  isOwned
                    ? {
                        backgroundColor: isDarkMode ? withAlpha(owner.color.fg, 0.5) : makeVividTint(owner.color.fg),
                        borderColor: owner.color.fg,
                        borderLeftWidth: 4,
                      }
                    : hasSharedOwners
                      ? styles.itemCardShared
                    : isIgnored
                      ? styles.itemCardIgnored
                      : styles.itemCardUnassigned,
                ]}
              >
                <View style={styles.itemRow}>
                  {isEditableManualItem ? (
                    <View style={styles.manualItemNameWrap}>
                      <Pencil size={12} color={ownedTextColor ?? themeColors.textMuted} />
                      <TextInput
                        style={[styles.itemNameInput, { color: themeColors.textSecondary, borderColor: themeColors.borderStrong, backgroundColor: themeColors.surface }]}
                        defaultValue={itemDisplayName}
                        placeholder={t("receipt.newItem")}
                        placeholderTextColor={themeColors.textMuted}
                        selectTextOnFocus
                        onFocus={() => {
                          setTimeout(() => {
                            mainScrollRef.current?.scrollToEnd({ animated: true });
                          }, 120);
                        }}
                        onEndEditing={(e) => {
                          if (!receiptAnalysis) return;
                          const nextName = e.nativeEvent.text.trim() || t("receipt.newItem");
                          const previousName = item.name;
                          const updatedItems = receiptAnalysis.items.map((it) =>
                            it.id === item.id ? { ...it, name: nextName } : it,
                          );
                          setReceiptAnalysis({ ...receiptAnalysis, items: updatedItems });
                          setPersons((prev) =>
                            prev.map((person) => ({
                              ...person,
                              selectedItems: person.selectedItems.map((selected) =>
                                selected === previousName ? nextName : selected,
                              ),
                            })),
                          );
                          setIsFinalized(false);
                        }}
                      />
                    </View>
                  ) : (
                    <Text style={[styles.itemName, { color: themeColors.textPrimary }]}>{itemDisplayName}</Text>
                  )}
                  {item.quantity > 1 && (
                    <Text style={[styles.itemQty, { color: ownedTextColor ? "rgba(255,255,255,0.8)" : themeColors.textSecondary }]}>×{item.quantity}</Text>
                  )}
                  <TextInput
                    style={[styles.itemPriceInput, { color: ownedTextColor ?? themeColors.textPrimary, borderBottomColor: themeColors.borderStrong }]}
                    defaultValue={formatInputAmt(item.quantity * item.unitPrice)}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    accessibilityLabel={`${t("bill.manual.itemPriceLabel")} ${item.name}`}
                    onEndEditing={(e) => {
                      const raw = parseMoneyInput(e.nativeEvent.text);
                      if (raw !== null && receiptAnalysis) {
                        setInputError(null);
                        const newUnitPrice = item.quantity > 0 ? raw / item.quantity : raw;
                        const updatedItems = receiptAnalysis.items.map((it) =>
                          it.id === item.id ? { ...it, unitPrice: newUnitPrice } : it
                        );
                        const newSubtotal = fromCents(
                          updatedItems.reduce((sum, it) => sum + toCents(it.quantity * it.unitPrice), 0),
                        );
                        const updatedAnalysis = { ...receiptAnalysis, items: updatedItems, subtotal: newSubtotal };
                        setReceiptAnalysis(updatedAnalysis);
                        setPersons(recalculatePeopleFromAnalysis(updatedAnalysis, persons));
                        setIsFinalized(false);
                      }
                    }}
                  />
                  {owner ? (
                    <Text style={[styles.itemOwnerTag, { color: ownedTextColor ?? themeColors.textPrimary }]}>
                      {item.quantity > 1 ? `${owner.name} (${assignedQty}/${item.quantity})` : owner.name}
                    </Text>
                  ) : ownerSegments.length > 1 ? (
                    <Text style={[styles.itemOwnerTag, styles.itemMultiOwnerTag, { color: themeColors.textPrimary }]}>
                      {t("camera.item.assignedCount", { assigned: assignedQty, total: item.quantity })}
                    </Text>
                  ) : (
                    <Text style={[styles.itemOwnerTag, isIgnored ? styles.itemIgnoredTag : styles.itemUnassignedTag, { color: themeColors.textPrimary }]}>
                      {isIgnored ? t("receipt.unassigned.ignored") : t("receipt.unassignedBadge")}
                    </Text>
                  )}
                </View>
                {isAssignmentOpen && (
                  <View style={styles.itemAssignPanel}>
                    <Text style={[styles.itemAssignLabel, { color: themeColors.warningText }]}>{t("receipt.unassigned.assignTo")}</Text>
                    <View style={styles.assignRow}>
                      {persons.map((person) => (
                        <TouchableOpacity
                          key={`${item.id}-${person.id}`}
                          style={[
                            styles.assignChip,
                            { backgroundColor: themeColors.surface, borderColor: themeColors.warningBorder },
                            (allocation[person.id] ?? 0) > 0 && styles.assignChipActive,
                          ]}
                          onPress={() => {
                            if (item.quantity > 1) {
                              openAssignQuantityModal(item, person.id);
                              return;
                            }
                            const result = applyAssignmentForItem(item, person.id, 1);
                            if (result.ok) {
                              setExpandedAssignmentItemId(null);
                            }
                          }}
                        >
                          <Text style={[styles.assignChipText, { color: themeColors.warningText }]}>
                            {item.quantity > 1
                              ? `${person.name} (${allocation[person.id] ?? 0})`
                              : person.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.itemActionRow}>
                      {!isIgnored ? (
                        <TouchableOpacity
                          style={[styles.assignSecondaryBtn, { borderColor: themeColors.warningBorder, backgroundColor: themeColors.warningBg }]}
                          onPress={() => openSplitModal(item.id)}
                        >
                          <Text style={[styles.assignSecondaryText, { color: themeColors.warningText }]}>{t("receipt.unassigned.splitLine")}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={styles.itemDeleteBtn}
                        onPress={() => setPendingDeleteItem({ id: item.id, name: itemDisplayName })}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${itemDisplayName}`}
                      >
                        <Trash2 size={14} color="#B42318" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {/* Add Item button */}
          <TouchableOpacity
            style={styles.addItemBtn}
            onPress={() => {
              if (!receiptAnalysis) return;
              const newItem = {
                id: `manual-item-${Date.now()}`,
                name: t("receipt.newItem"),
                quantity: 1,
                unitPrice: 0,
              };
              const updatedItems = [...receiptAnalysis.items, newItem];
              const subtotal = fromCents(updatedItems.reduce((sum, item) => sum + toCents(item.quantity * item.unitPrice), 0));
              setReceiptAnalysis({ ...receiptAnalysis, items: updatedItems, subtotal });
              setIsFinalized(false);
              scrollMainToBottomSoon();
            }}
          >
            <Plus size={15} color={themeColors.textSecondary} />
            <Text style={[styles.addItemText, { color: themeColors.textSecondary }]}>{t("receipt.addItem")}</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* ── Summary button ── */}
      {receiptAnalysis && areAllItemsAssigned && (
        <TouchableOpacity
          style={styles.summaryBtn}
          onPress={() => setShowSummary(true)}
        >
          <Share2 size={16} color="#FFFFFF" />
          <Text style={styles.summaryBtnText}>{t("summary.title")}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
    </KeyboardAvoidingView>

    <Modal
      visible={isVoiceBusy}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (listeningPersonId) {
          onMicPress(listeningPersonId);
        }
      }}
    >
      <View style={[styles.voiceOverlay, { backgroundColor: themeColors.overlay }]}>
        <View style={[styles.voiceOverlayCard, { backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong }]}>
          <View style={styles.voiceStateIconWrap}>
            {listeningPersonId ? (
              <Mic size={30} color="#1570EF" />
            ) : (
              <ActivityIndicator size="large" color="#1570EF" />
            )}
          </View>
          <View style={styles.voiceStatusTextWrap}>
            <Text style={[styles.voiceStatusTitle, { color: themeColors.textPrimary }]}>{voiceOverlayTitle}</Text>
            {voiceOverlayHint ? <Text style={[styles.voiceStatusHint, { color: themeColors.textSecondary }]}>{voiceOverlayHint}</Text> : null}
          </View>
          {listeningPersonId ? (
            <TouchableOpacity
              style={styles.voiceStopBtn}
              onPress={() => onMicPress(listeningPersonId)}
              accessibilityRole="button"
              accessibilityLabel={t("voice.stop")}
            >
              <Square size={14} color="#FFFFFF" fill="#FFFFFF" />
              <Text style={styles.voiceStopText}>{t("voice.stop")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>

    <Modal
      visible={!!voiceClaimWarning}
      transparent
      animationType="fade"
      onRequestClose={() => setVoiceClaimWarning(null)}
    >
      <TouchableWithoutFeedback onPress={() => setVoiceClaimWarning(null)}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("voice.claim.limit.title")}</Text>
              <Text style={[styles.scanReplaceConfirmText, { color: themeColors.textSecondary }]}>{voiceClaimWarning ?? ""}</Text>
              <View style={styles.splitActionRow}>
                <TouchableOpacity style={styles.splitApplyBtn} onPress={() => setVoiceClaimWarning(null)}>
                  <Text style={styles.splitApplyText}>{t("error.action.dismiss")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    <CaptureSheet
      visible={showCaptureSheet}
      onTakePhoto={onTakePhoto}
      onUpload={onPickFromGallery}
      onClose={() => setShowCaptureSheet(false)}
      isDarkMode={isDarkMode}
    />

    <Modal
      visible={showScanReplaceConfirm}
      transparent
      animationType="fade"
      onRequestClose={() => setShowScanReplaceConfirm(false)}
    >
      <TouchableWithoutFeedback onPress={() => setShowScanReplaceConfirm(false)}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("receipt.scanNew")}</Text>
              <Text style={[styles.scanReplaceConfirmText, { color: themeColors.textSecondary }]}>
                Scanning a new receipt will replace current assignments. Continue?
              </Text>
              <View style={styles.splitActionRow}>
                <TouchableOpacity style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={() => setShowScanReplaceConfirm(false)}>
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("capture.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.splitApplyBtn, styles.scanReplaceConfirmBtn]}
                  onPress={() => {
                    setShowScanReplaceConfirm(false);
                    setShowCaptureSheet(true);
                  }}
                >
                  <Text style={styles.splitApplyText}>{t("receipt.scanNew")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    <Modal
      visible={!!pendingRemovePerson}
      transparent
      animationType="fade"
      onRequestClose={() => setPendingRemovePerson(null)}
    >
      <TouchableWithoutFeedback onPress={() => setPendingRemovePerson(null)}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{pendingRemovePerson?.name ?? ""}</Text>
              <Text style={[styles.scanReplaceConfirmText, { color: themeColors.textSecondary }]}>{t("person.remove.confirmBody")}</Text>
              <View style={styles.splitActionRow}>
                <TouchableOpacity style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={() => setPendingRemovePerson(null)}>
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("capture.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.splitApplyBtn, styles.scanReplaceConfirmBtn]}
                  onPress={() => {
                    if (!pendingRemovePerson) return;
                    removePersonById(pendingRemovePerson.id);
                    setPendingRemovePerson(null);
                  }}
                >
                  <Text style={styles.splitApplyText}>{t("person.remove.confirmAction")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    <Modal
      visible={!!pendingDeleteItem}
      transparent
      animationType="fade"
      onRequestClose={() => setPendingDeleteItem(null)}
    >
      <TouchableWithoutFeedback onPress={() => setPendingDeleteItem(null)}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("expense.delete.title")}</Text>
              <Text style={[styles.scanReplaceConfirmText, { color: themeColors.textSecondary }]}>
                {t("expense.delete.confirmBody", {
                  itemName: pendingDeleteItem?.name ?? t("expense.delete.itemFallback"),
                })}
              </Text>
              <View style={styles.splitActionRow}>
                <TouchableOpacity style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={() => setPendingDeleteItem(null)}>
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("capture.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.splitApplyBtn, styles.scanReplaceConfirmBtn]}
                  onPress={() => {
                    if (!pendingDeleteItem) return;
                    deleteItemById(pendingDeleteItem.id);
                    setPendingDeleteItem(null);
                  }}
                >
                  <Text style={styles.splitApplyText}>{t("expense.delete.action")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    <PersonDetailModal
      person={selectedPerson}
      isDarkMode={isDarkMode}
      receiptItems={receiptAnalysis?.items ?? []}
      formatInputAmt={formatInputAmt}
      formatMoney={(value) => formatMoney(value)}
      getAssignedQuantity={(itemId, personId) => {
        if (!receiptAnalysis) return 0;
        const item = receiptAnalysis.items.find((entry) => entry.id === itemId);
        if (!item) return 0;
        return getItemAllocation(item)[personId] ?? 0;
      }}
      onClose={() => setSelectedPersonId(null)}
      bottomSheetInset={bottomSheetInset}
      tipMode={tipMode}
      personTipPct={selectedPerson ? (personTipPcts[selectedPerson.id] ?? 0) : 0}
      onTipPctChange={(pct) => {
        if (!selectedPerson) return;
        const updated = { ...personTipPcts, [selectedPerson.id]: pct };
        setPersonTipPcts(updated);
        if (receiptAnalysis) {
          setPersons(recalculatePeopleFromAnalysis(receiptAnalysis, persons, itemAssignments, "individual", updated));
        }
        setIsFinalized(false);
      }}
    />

    <Modal
      visible={!!assignQtyTargetItem && !!assignQtyTarget}
      transparent
      animationType="fade"
      onRequestClose={closeAssignQuantityModal}
    >
      <TouchableWithoutFeedback onPress={closeAssignQuantityModal}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("camera.assign.title")}</Text>
              <Text style={[styles.splitSubtitle, { color: themeColors.textMuted }]}>
                {assignQtyTargetItem ? `${assignQtyTargetItem.name} (x${assignQtyTargetItem.quantity})` : ""}
              </Text>
              <View style={styles.assignQtySelectorWrap}>
                <ScrollView
                  ref={assignQtyScrollRef}
                  style={styles.assignQtySelector}
                  contentContainerStyle={styles.assignQtySelectorContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ASSIGN_QTY_ROW_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(event) => {
                    const rawIndex = Math.round(event.nativeEvent.contentOffset.y / ASSIGN_QTY_ROW_HEIGHT);
                    const clampedIndex = Math.max(0, Math.min(assignQtyOptions.length - 1, rawIndex));
                    selectAssignQty(assignQtyOptions[clampedIndex] ?? "1", false);
                  }}
                  onScrollEndDrag={(event) => {
                    const rawIndex = Math.round(event.nativeEvent.contentOffset.y / ASSIGN_QTY_ROW_HEIGHT);
                    const clampedIndex = Math.max(0, Math.min(assignQtyOptions.length - 1, rawIndex));
                    selectAssignQty(assignQtyOptions[clampedIndex] ?? "1", false);
                  }}
                >
                  {assignQtyOptions.map((option) => (
                    <TouchableOpacity key={option} style={styles.assignQtyOptionRow} onPress={() => selectAssignQty(option)}>
                      <Text style={[styles.assignQtyOptionText, { color: themeColors.textMuted }, assignQtyDraft === option && styles.assignQtyOptionTextActive]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View pointerEvents="none" style={styles.assignQtySelectorCenter} />
              </View>
              <Text style={[styles.assignQtyHint, { color: themeColors.textMuted }]}>
                {t("camera.assign.maxForLineItem", { count: assignQtyTargetItem?.quantity ?? 0 })}
              </Text>
              {assignQtyError ? <Text style={styles.splitErrorText}>{assignQtyError}</Text> : null}
              <View style={styles.splitActionRow}>
                <TouchableOpacity style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={closeAssignQuantityModal}>
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("capture.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.splitApplyBtn} onPress={confirmAssignQuantity}>
                  <Text style={styles.splitApplyText}>{t("common.save")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    <Modal
      visible={!!splitTargetItem}
      transparent
      animationType="fade"
      onRequestClose={closeSplitModal}
    >
      <TouchableWithoutFeedback onPress={closeSplitModal}>
        <KeyboardAvoidingView
          style={styles.splitKeyboardContainer}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        >
          <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }, isSplitKeyboardVisible && styles.splitOverlayWithKeyboard]}>
            <TouchableWithoutFeedback>
              <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("receipt.unassigned.splitLine")}</Text>
              <Text style={[styles.splitSubtitle, { color: themeColors.textMuted }]}>
                {splitTargetItem ? `${splitTargetItem.name} (${formatMoney(splitTargetItem.quantity * splitTargetItem.unitPrice)})` : ""}
              </Text>

              <View style={styles.splitModeRow}>
                <TouchableOpacity
                  style={[
                    styles.splitModeBtn,
                    { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border },
                    splitMode === "equal" && styles.splitModeBtnActive,
                  ]}
                  onPress={() => setSplitMode("equal")}
                >
                  <Text style={[styles.splitModeText, { color: themeColors.textSecondary }, splitMode === "equal" && styles.splitModeTextActive]}>
                    {t("camera.split.mode.equal")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.splitModeBtn,
                    { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border },
                    splitMode === "custom" && styles.splitModeBtnActive,
                  ]}
                  onPress={() => setSplitMode("custom")}
                >
                  <Text style={[styles.splitModeText, { color: themeColors.textSecondary }, splitMode === "custom" && styles.splitModeTextActive]}>
                    {t("camera.split.mode.custom")}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.splitPeopleWrap}>
                {persons.map((person) => {
                  const selected = splitPersonIds.includes(person.id);
                  return (
                    <View key={person.id} style={styles.splitPersonRow}>
                      <TouchableOpacity
                        style={[
                          styles.splitPersonChip,
                          { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                          selected && styles.splitPersonChipActive,
                        ]}
                        onPress={() => {
                          setSplitPersonIds((prev) => {
                            if (prev.includes(person.id)) {
                              return prev.filter((id) => id !== person.id);
                            }
                            return [...prev, person.id];
                          });
                        }}
                      >
                        <Text style={[styles.splitPersonText, { color: themeColors.textSecondary }, selected && styles.splitPersonTextActive]}>{person.name}</Text>
                      </TouchableOpacity>
                      {splitMode === "custom" && selected ? (
                        <TextInput
                          style={[styles.splitAmountInput, { backgroundColor: themeColors.inputBg, borderColor: themeColors.borderStrong, color: themeColors.textPrimary }]}
                          keyboardType="decimal-pad"
                          value={splitCustomAmounts[person.id] ?? ""}
                          placeholder="0.00"
                          placeholderTextColor={themeColors.textMuted}
                          onChangeText={(text) => {
                            setSplitCustomAmounts((prev) => ({ ...prev, [person.id]: text }));
                          }}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {splitMode === "custom" && splitTargetItem ? (
                <Text style={[styles.splitHelperText, { color: themeColors.textMuted }]}>
                  {t("camera.split.helper.customSummary", {
                    total: formatMoney(fromCents(splitTargetTotalCents)),
                    current: formatMoney(fromCents(customSplitStatus.sumCents)),
                  })}
                </Text>
              ) : null}

              {splitValidationError ? <Text style={styles.splitErrorText}>{splitValidationError}</Text> : null}

              <View style={styles.splitActionRow}>
                <TouchableOpacity style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={closeSplitModal}>
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("capture.cancel")}</Text>
                </TouchableOpacity>
                {(splitMode !== "custom" || customSplitStatus.isSumCorrect) ? (
                  <TouchableOpacity
                    style={[
                      styles.splitApplyBtn,
                      splitMode === "equal" && splitPersonIds.length < 2 && styles.splitApplyBtnDisabled,
                    ]}
                    onPress={applySplitForItem}
                    disabled={splitMode === "equal" && splitPersonIds.length < 2}
                  >
                    <Text style={styles.splitApplyText}>{t("camera.split.apply")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Modal>
    {/* ── Voice match confirmation modal ── */}
    <Modal
      visible={!!pendingVoiceMatch}
      transparent
      animationType="fade"
      onRequestClose={() => setPendingVoiceMatch(null)}
    >
      <TouchableWithoutFeedback onPress={() => setPendingVoiceMatch(null)}>
        <View style={[styles.splitOverlay, { backgroundColor: themeColors.overlay }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.splitCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
              <Text style={[styles.splitTitle, { color: themeColors.textPrimary }]}>{t("voice.confirm.title")}</Text>
              <Text style={[styles.splitSubtitle, { color: themeColors.textMuted }]}>
                {t("voice.confirm.subtitle", { name: pendingVoiceMatch?.personName ?? "" })}
              </Text>
              {pendingVoiceMatch && pendingVoiceMatch.matchedItems.length === 0 ? (
                <Text style={[styles.scanReplaceConfirmText, { color: themeColors.textSecondary }]}>
                  {t("voice.confirm.noMatches")}
                </Text>
              ) : (
                <View style={styles.voiceConfirmList}>
                  {pendingVoiceMatch?.matchedItems.map((item, i) => (
                    <View key={i} style={[styles.voiceConfirmItem, { borderColor: themeColors.border, backgroundColor: themeColors.surfaceAlt }]}>
                      <Text style={[styles.voiceConfirmItemText, { color: themeColors.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.voiceConfirmItemQty, { color: themeColors.textMuted }]}>x{item.qty}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.splitActionRow}>
                <TouchableOpacity
                  style={[styles.splitCancelBtn, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]}
                  onPress={() => setPendingVoiceMatch(null)}
                >
                  <Text style={[styles.splitCancelText, { color: themeColors.textSecondary }]}>{t("voice.confirm.reject")}</Text>
                </TouchableOpacity>
                {pendingVoiceMatch && pendingVoiceMatch.matchedItems.length > 0 ? (
                  <TouchableOpacity
                    style={styles.splitApplyBtn}
                    onPress={() => {
                      pendingVoiceMatch.applyFn();
                      setPendingVoiceMatch(null);
                    }}
                  >
                    <Text style={styles.splitApplyText}>{t("voice.confirm.accept")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    {/* ── Split summary modal ── */}
    <Modal
      visible={showSummary}
      transparent
      animationType="slide"
      onRequestClose={() => setShowSummary(false)}
    >
      <View style={modalStyles.modalRoot}>
        <TouchableWithoutFeedback onPress={() => setShowSummary(false)}>
          <View style={[modalStyles.backdrop, { backgroundColor: isDarkMode ? "rgba(2, 6, 23, 0.78)" : "rgba(0,0,0,0.45)" }]} />
        </TouchableWithoutFeedback>
        <View style={[modalStyles.sheet, { backgroundColor: isDarkMode ? "#182230" : "#FFFFFF", paddingBottom: 40 + bottomSheetInset }]}>
          <View style={[modalStyles.handle, { backgroundColor: isDarkMode ? "#344054" : "#D0D5DD" }]} />
          <View style={[modalStyles.header, { borderBottomColor: isDarkMode ? "#344054" : "#F2F4F7" }]}>
            <Text style={[modalStyles.personName, { color: themeColors.textPrimary }]}>{t("summary.title")}</Text>
            <TouchableOpacity style={modalStyles.headerCloseBtn} onPress={() => setShowSummary(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.splitSubtitle, { color: themeColors.textMuted, marginBottom: 8, paddingHorizontal: 0 }]}>{t("summary.subtitle")}</Text>
          <ScrollView style={modalStyles.scroll} showsVerticalScrollIndicator={false}>
            {persons.map((person) => {
              const assignedCount = (receiptAnalysis?.items ?? []).filter((item) => {
                const alloc = getItemAllocation(item);
                return (alloc[person.id] ?? 0) > 0;
              }).length;
              return (
                <TouchableOpacity key={person.id} style={[styles.summaryPersonCard, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]} onPress={() => { setShowSummary(false); setSelectedPersonId(person.id); }} activeOpacity={0.7}>
                  <View style={styles.summaryPersonInfo}>
                    <Text style={[styles.summaryPersonName, { color: themeColors.textPrimary }]}>{person.name}</Text>
                    <Text style={[styles.summaryPersonMeta, { color: themeColors.textMuted }]}>
                      {assignedCount > 0 ? t("summary.person.items", { count: assignedCount }) : t("summary.noItems")}
                    </Text>
                  </View>
                  <Text style={[styles.summaryPersonTotal, { color: person.grandTotal > 0 ? "#1570EF" : themeColors.textMuted }]}>
                    {formatMoney(person.grandTotal)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <View style={[styles.summaryGrandTotal, { borderTopColor: themeColors.border }]}>
              <Text style={[styles.summaryGrandTotalLabel, { color: themeColors.textSecondary }]}>{t("summary.grandTotal")}</Text>
              <Text style={[styles.summaryGrandTotalValue, { color: themeColors.textPrimary }]}>{formatMoney(grandTotal)}</Text>
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.summaryDoneBtn} onPress={() => setShowSummary(false)}>
            <Text style={styles.summaryDoneBtnText}>{t("summary.close")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* ── Voice tooltip ── */}
    {showVoiceTooltip && (
      <View pointerEvents="box-none" style={styles.voiceTooltipOverlay}>
        <View style={[styles.voiceTooltipCard, { backgroundColor: themeColors.surface, borderColor: "#1570EF" }]}>
          <Info size={16} color="#1570EF" />
          <Text style={[styles.voiceTooltipText, { color: themeColors.textPrimary }]}>{t("voice.tooltip")}</Text>
          <TouchableOpacity onPress={() => setShowVoiceTooltip(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.voiceTooltipDismiss}>{t("voice.tooltip.dismiss")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}

    {flowMessage || showAssignmentConfetti ? (
      <View pointerEvents="none" style={styles.assignmentCelebrationOverlay}>
        {showAssignmentConfetti ? (
          <>
            <ConfettiCannon
              key={`assign-left-${assignmentCelebrationBurstId}`}
              count={80}
              origin={{ x: -12, y: -8 }}
              fadeOut
              autoStart
              explosionSpeed={450}
              fallSpeed={4200}
            />
            <ConfettiCannon
              key={`assign-right-${assignmentCelebrationBurstId}`}
              count={80}
              origin={{ x: Dimensions.get("window").width + 12, y: -8 }}
              fadeOut
              autoStart
              explosionSpeed={450}
              fallSpeed={4200}
            />
          </>
        ) : null}
        {flowMessage ? (
          <Animated.View
            style={[
              styles.assignmentCelebrationBanner,
              {
                opacity: assignmentCelebrationOpacity,
                transform: [{ translateY: assignmentCelebrationTranslateY }, { scale: assignmentCelebrationScale }],
              },
            ]}
          >
            <Text style={styles.assignmentCelebrationText}>{flowMessage}</Text>
          </Animated.View>
        ) : null}
      </View>
    ) : null}
    {isAnalyzing ? <View pointerEvents="auto" style={styles.interactionBlocker} /> : null}
    </View>
  );
}

// ── PersonDetailModal ──────────────────────────────────────────────────────
interface PersonDetailModalProps {
  person: Person | null;
  isDarkMode: boolean;
  receiptItems: import("../types/billing").ReceiptItem[];
  formatInputAmt: (v: number) => string;
  formatMoney: (v: number) => string;
  getAssignedQuantity: (itemId: string, personId: string) => number;
  onClose: () => void;
  tipMode?: "receipt" | "individual";
  personTipPct?: number;
  onTipPctChange?: (pct: number) => void;
  bottomSheetInset?: number;
}

function PersonDetailModal({
  person,
  isDarkMode,
  receiptItems,
  formatInputAmt,
  formatMoney,
  getAssignedQuantity,
  onClose,
  tipMode = "receipt",
  personTipPct = 0,
  onTipPctChange,
  bottomSheetInset = 0,
}: PersonDetailModalProps) {
  const { t } = useI18n();
  if (!person) return null;
  const palette = isDarkMode
    ? {
        overlay: "rgba(2, 6, 23, 0.78)",
        sheet: "#182230",
        card: "#1F2A37",
        border: "#344054",
        textPrimary: "#F2F4F7",
        textSecondary: "#D0D5DD",
        textMuted: "#98A2B3",
      }
    : {
        overlay: "rgba(0,0,0,0.45)",
        sheet: "#FFFFFF",
        card: "#F9FAFB",
        border: "#EAECF0",
        textPrimary: "#101828",
        textSecondary: "#344054",
        textMuted: "#667085",
      };

  const assignedItems = receiptItems.filter((item) => getAssignedQuantity(item.id, person.id) > 0);

  return (
    <Modal
      visible={!!person}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={modalStyles.modalRoot}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[modalStyles.backdrop, { backgroundColor: palette.overlay }]} />
        </TouchableWithoutFeedback>

        <View style={[modalStyles.sheet, { backgroundColor: palette.sheet, paddingBottom: 40 + bottomSheetInset }]}>
          {/* Handle */}
          <View style={[modalStyles.handle, { backgroundColor: palette.border }]} />

          {/* Header with avatar */}
          <View style={[modalStyles.header, { borderBottomColor: palette.border }]}>
                  <Text style={[modalStyles.personName, { color: palette.textPrimary }]}>{person.name}</Text>
                  <TouchableOpacity
                    style={modalStyles.headerCloseBtn}
                    onPress={onClose}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
              <X size={20} color={palette.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={modalStyles.scroll} showsVerticalScrollIndicator={false}>
            {assignedItems.length === 0 ? (
              <View style={modalStyles.emptyState}>
                <View style={modalStyles.emptyIconWrap}>
                  <Mic size={32} color={palette.textMuted} />
                </View>
                <Text style={[modalStyles.emptyText, { color: palette.textSecondary }]}>{t("detail.noItemsTitle")}</Text>
                <Text style={[modalStyles.emptyHint, { color: palette.textMuted }]}>
                  {t("detail.noItemsHint", { name: person.name })}
                </Text>
                <View style={[modalStyles.emptySteps, { backgroundColor: palette.card }]}>
                  <View style={modalStyles.emptyStepRow}>
                    <ClipboardList size={15} color={palette.textSecondary} />
                    <Text style={[modalStyles.emptyStep, { color: palette.textSecondary }]}>{t("detail.step1")}</Text>
                  </View>
                  <View style={modalStyles.emptyStepRow}>
                    <MicOff size={15} color={palette.textSecondary} />
                    <Text style={[modalStyles.emptyStep, { color: palette.textSecondary }]}>{t("detail.step2")}</Text>
                  </View>
                  <View style={modalStyles.emptyStepRow}>
                    <Hand size={15} color={palette.textSecondary} />
                    <Text style={[modalStyles.emptyStep, { color: palette.textSecondary }]}>{t("detail.step3")}</Text>
                  </View>
                </View>
              </View>
            ) : (
              <>
                {/* Items list */}
                <Text style={[modalStyles.sectionLabel, { color: palette.textMuted }]}>{t("detail.items")}</Text>
                {assignedItems.map((item) => {
                  const assignedQty = getAssignedQuantity(item.id, person.id);
                  const personSuffix = ` (${person.name})`;
                  const displayName = item.name.endsWith(personSuffix)
                    ? item.name.slice(0, -personSuffix.length)
                    : item.name;
                  return (
                    <View key={item.id} style={[modalStyles.itemRow, { borderBottomColor: palette.border }]}>
                      <View style={modalStyles.itemLeft}>
                        <Text style={[modalStyles.itemName, { color: palette.textPrimary }]}>{displayName}</Text>
                        <Text style={[modalStyles.itemQty, { color: palette.textMuted }]}>
                          {t("detail.assignedQuantity", { assigned: assignedQty, total: item.quantity })}
                        </Text>
                      </View>
                      <Text style={[modalStyles.itemPrice, { color: palette.textPrimary }]}>{formatInputAmt(assignedQty * item.unitPrice)}</Text>
                    </View>
                  );
                })}

                {/* Breakdown */}
                <View style={[modalStyles.divider, { backgroundColor: palette.border }]} />
                <View style={modalStyles.breakdownRow}>
                  <Text style={[modalStyles.breakdownLabel, { color: palette.textMuted }]}>{t("detail.subtotal")}</Text>
                  <Text style={[modalStyles.breakdownValue, { color: palette.textSecondary }]}>{formatMoney(person.subtotal)}</Text>
                </View>
                {tipMode === "individual" ? (
                  <>
                    <View style={modalStyles.breakdownRow}>
                      <Text style={[modalStyles.breakdownLabel, { color: palette.textMuted }]}>{t("detail.taxFees")}</Text>
                      <Text style={[modalStyles.breakdownValue, { color: palette.textSecondary }]}>
                        {formatMoney(person.taxTipShare - Math.round(person.subtotal * personTipPct) / 100)}
                      </Text>
                    </View>
                    {/* Tip % selector */}
                    <View style={modalStyles.breakdownRow}>
                      <Text style={[modalStyles.breakdownLabel, { color: palette.textMuted }]}>{t("detail.tip")}</Text>
                    </View>
                    <View style={modalStyles.tipSelectorRow}>
                      {[0, 15, 18, 20, 25].map((pct) => {
                        const isActive = personTipPct === pct;
                        return (
                          <TouchableOpacity
                            key={pct}
                            style={[
                              modalStyles.tipBtn,
                              { backgroundColor: palette.card, borderColor: palette.border },
                              isActive && { backgroundColor: "#1570EF", borderColor: "#1570EF" },
                            ]}
                            onPress={() => onTipPctChange?.(pct)}
                          >
                            <Text style={[modalStyles.tipBtnText, { color: palette.textSecondary }, isActive && { color: "#FFFFFF" }]}>
                              {pct === 0 ? (t("tip.preset.none")) : `${pct}%`}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {personTipPct > 0 && (
                      <View style={[modalStyles.breakdownRow, { marginTop: 4 }]}>
                        <Text style={[modalStyles.breakdownLabel, { color: palette.textMuted }]}>{t("detail.tip")} ({personTipPct}%)</Text>
                        <Text style={[modalStyles.breakdownValue, { color: palette.textSecondary }]}>
                          {formatMoney(Math.round(person.subtotal * personTipPct) / 100)}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={modalStyles.breakdownRow}>
                    <Text style={[modalStyles.breakdownLabel, { color: palette.textMuted }]}>{t("detail.taxTipFees")}</Text>
                    <Text style={[modalStyles.breakdownValue, { color: palette.textSecondary }]}>{formatMoney(person.taxTipShare)}</Text>
                  </View>
                )}
                <View style={[modalStyles.breakdownRow, modalStyles.totalRow, { borderTopColor: palette.border }]}>
                  <Text style={[modalStyles.totalLabel, { color: palette.textPrimary }]}>{t("detail.total")}</Text>
                  <Text style={[modalStyles.totalValue, { color: palette.textPrimary }]}>{formatMoney(person.grandTotal)}</Text>
                </View>
              </>
            )}

            {/* Voice transcript */}
            {!!person.voiceTranscript && (
              <View style={[modalStyles.transcriptBox, { backgroundColor: palette.card }]}>
                <View style={modalStyles.transcriptHeader}>
                  <Mic size={13} color={palette.textMuted} />
                  <Text style={[modalStyles.transcriptLabel, { color: palette.textMuted }]}>{t("detail.whatYouSaid")}</Text>
                </View>
                <Text style={[modalStyles.transcriptText, { color: palette.textSecondary }]}>"{person.voiceTranscript}"</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const styles = StyleSheet.create({
  // Layout
  root: { flex: 1 },
  screenKeyboardContainer: { flex: 1 },
  interactionBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    backgroundColor: "transparent",
  },
  scrollView: { flex: 1 },
  container: { gap: 14, paddingBottom: 32 },

  // Receipt area
  receiptArea: {
    height: 220,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#98A2B3",
    overflow: "hidden",
    backgroundColor: "#F9FAFB",
  },
  receiptPreviewWrap: {
    width: "100%",
    height: "100%",
  },
  receiptPreview: { width: "100%", height: "100%" },
  receiptAnalyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 24, 40, 0.35)",
    gap: 8,
  },
  receiptPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  receiptIconRow: {
    flexDirection: "row",
    gap: 16,
  },
  receiptHint: {
    fontSize: 14,
    color: "#98A2B3",
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 16,
    maxWidth: "92%",
    alignSelf: "center",
  },
  receiptActionBtn: {
    marginTop: -4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receiptActionText: {
    fontSize: 14,
    color: "#475467",
    fontWeight: "600",
  },

  // Errors
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    padding: 10,
    gap: 8,
  },
  errorText: { color: "#B42318", fontSize: 13, fontWeight: "500" },
  micErrorText: { color: "#B42318", fontSize: 13, fontWeight: "500" },
  errorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  errorActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FFFFFF",
  },
  errorActionText: {
    fontSize: 12,
    color: "#B42318",
    fontWeight: "700",
  },

  assignmentCelebrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 80,
  },
  assignmentCelebrationBanner: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#86EFAC",
    backgroundColor: "#ECFDF3",
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: "88%",
    alignSelf: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  assignmentCelebrationText: {
    fontSize: 16,
    lineHeight: 22,
    color: "#067647",
    fontWeight: "800",
    textAlign: "center",
  },
  // People card
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#EAECF0",
    gap: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#667085",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  addPersonBtn: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#98A2B3",
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addPersonText: { color: "#475467", fontSize: 14, fontWeight: "600" },
  splitTotalRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#EAECF0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  splitTotalLabel: {
    color: "#667085",
    fontSize: 13,
    fontWeight: "700",
  },
  splitTotalValue: {
    color: "#101828",
    fontSize: 15,
    fontWeight: "800",
  },

  // Receipt items (color-coded)
  inlineGapBanner: {
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FEC84B",
    backgroundColor: "#FFFAEB",
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inlineGapBannerText: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "700",
  },
  itemCard: {
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#98A2B3",
  },
  itemCardSplit: {
    backgroundColor: "#F8FAFC",
  },
  itemCardShared: {
    backgroundColor: "#F2F4F7",
    borderColor: "#98A2B3",
    borderLeftWidth: 4,
  },
  itemCardUnassigned: {
    backgroundColor: "#FDE68A",
    borderColor: "#F59E0B",
    borderLeftWidth: 4,
  },
  itemCardIgnored: {
    backgroundColor: "#D0D5DD",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    color: "#000000",
    fontWeight: "500",
  },
  itemNameInput: {
    flex: 1,
    fontSize: 14,
    color: "#344054",
    fontWeight: "500",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
  },
  manualItemNameWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemQty: {
    fontSize: 12,
    color: "#000000",
    fontWeight: "500",
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#344054",
    minWidth: 56,
    textAlign: "right",
  },
  itemPriceInput: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000000",
    minWidth: 64,
    textAlign: "right",
    borderBottomWidth: 1,
    borderBottomColor: "#D0D5DD",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  itemDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FEE4E2",
    backgroundColor: "#FEF3F2",
    alignItems: "center",
    justifyContent: "center",
  },
  itemOwnerTag: {
    fontSize: 11,
    fontWeight: "700",
    minWidth: 50,
    textAlign: "right",
    color: "#000000",
  },
  itemUnassignedTag: {
    color: "#000000",
  },
  itemIgnoredTag: {
    color: "#000000",
  },
  itemMultiOwnerTag: {
    color: "#000000",
  },
  itemAssignPanel: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 8,
  },
  itemActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemAssignLabel: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "700",
  },
  addItemBtn: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#98A2B3",
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addItemText: { color: "#475467", fontSize: 14, fontWeight: "600" },

  assignRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assignChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  assignChipActive: {
    backgroundColor: "#FEF3C7",
    borderColor: "#F59E0B",
  },
  assignChipText: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "700",
  },
  assignSecondaryBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  assignSecondaryText: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "700",
  },
  splitOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 24, 40, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  splitOverlayWithKeyboard: {
    justifyContent: "flex-end",
    paddingBottom: 24,
  },
  splitKeyboardContainer: {
    flex: 1,
  },
  splitCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 10,
  },
  splitTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#101828",
  },
  splitSubtitle: {
    fontSize: 13,
    color: "#667085",
  },
  scanReplaceConfirmText: {
    fontSize: 13,
    color: "#475467",
    lineHeight: 18,
  },
  scanReplaceConfirmBtn: {
    backgroundColor: "#B42318",
  },
  splitModeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  splitModeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    paddingVertical: 10,
    alignItems: "center",
  },
  splitModeBtnActive: {
    borderColor: "#1570EF",
    backgroundColor: "#EFF8FF",
  },
  splitModeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475467",
  },
  splitModeTextActive: {
    color: "#1570EF",
  },
  splitPeopleWrap: {
    gap: 8,
    marginTop: 2,
  },
  splitPersonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  splitPersonChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  splitPersonChipActive: {
    borderColor: "#1570EF",
    backgroundColor: "#EFF8FF",
  },
  splitPersonText: {
    fontSize: 13,
    color: "#475467",
    fontWeight: "600",
  },
  splitPersonTextActive: {
    color: "#1570EF",
  },
  splitAmountInput: {
    width: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: "#101828",
    textAlign: "right",
    fontWeight: "600",
  },
  assignQtySelectorWrap: {
    height: ASSIGN_QTY_ROW_HEIGHT * ASSIGN_QTY_VISIBLE_ROWS,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    position: "relative",
  },
  assignQtySelector: {
    flex: 1,
  },
  assignQtySelectorContent: {
    paddingVertical: ASSIGN_QTY_ROW_HEIGHT * 2,
  },
  assignQtyOptionRow: {
    height: ASSIGN_QTY_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  assignQtyOptionText: {
    fontSize: 18,
    color: "#667085",
    fontWeight: "600",
  },
  assignQtyOptionTextActive: {
    color: "#1570EF",
    fontWeight: "700",
  },
  assignQtySelectorCenter: {
    position: "absolute",
    left: 10,
    right: 10,
    top: ASSIGN_QTY_ROW_HEIGHT * 2,
    height: ASSIGN_QTY_ROW_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#B2DDFF",
    backgroundColor: "transparent",
  },
  assignQtyHint: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "500",
  },
  splitErrorText: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "600",
  },
  splitHelperText: {
    color: "#475467",
    fontSize: 12,
    fontWeight: "500",
  },
  splitActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  splitCancelBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  splitCancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475467",
  },
  splitApplyBtn: {
    borderRadius: 10,
    backgroundColor: "#1570EF",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  splitApplyBtnDisabled: {
    backgroundColor: "#98A2B3",
  },
  splitApplyText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Grand total
  // Charges card (tax / tip / service fee)
  chargesCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  chargesTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#344054",
    marginBottom: 10,
  },
  chargeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  chargeLabel: {
    fontSize: 14,
    color: "#667085",
    fontWeight: "500",
  },
  chargeInput: {
    fontSize: 14,
    fontWeight: "600",
    color: "#344054",
    minWidth: 80,
    textAlign: "right",
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D0D5DD",
  },

  grandTotalCard: {
    backgroundColor: "#1570EF",
    borderWidth: 1,
    borderColor: "#175CD3",
    borderRadius: 14,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  grandTotalLabel: { color: "#EAF2FF", fontSize: 15, fontWeight: "600" },
  grandTotalValue: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  leftToAssignCard: {
    backgroundColor: "#F8FAFC",
    borderColor: "#D0D5DD",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 4,
  },
  leftToAssignHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  leftToAssignLabel: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  leftToAssignValue: {
    color: "#B42318",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "right",
  },
  leftToAssignHint: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "500",
  },

  voiceOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 24, 40, 0.56)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  voiceOverlayCard: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
    shadowColor: "#101828",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  voiceStateIconWrap: {
    alignSelf: "center",
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceStatusTextWrap: {
    gap: 4,
  },
  voiceStatusTitle: {
    color: "#101828",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  voiceStatusHint: {
    color: "#475467",
    fontSize: 13,
    textAlign: "center",
  },
  voiceStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    backgroundColor: "#B42318",
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  voiceStopText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  // Tip mode toggle
  tipModeToggle: {
    flexDirection: "row" as const,
    gap: 6,
  },
  tipModeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  tipModeBtnActive: {
    backgroundColor: "#1570EF",
    borderColor: "#1570EF",
  },
  tipIndividualHint: {
    fontSize: 12,
    fontWeight: "500" as const,
    fontStyle: "italic" as const,
    marginBottom: 4,
  },
  // Tip presets
  tipPresetsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  tipPresetBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    alignItems: "center",
  },
  tipPresetBtnActive: {
    borderColor: "#1570EF",
    backgroundColor: "#EFF8FF",
  },
  tipPresetText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475467",
  },
  tipPresetTextActive: {
    color: "#1570EF",
  },

  // Progress bar
  progressBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  progressStep: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  progressDotDone: {
    backgroundColor: "#067647",
    borderColor: "#067647",
  },
  progressDotText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#667085",
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#667085",
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: "#EAECF0",
    borderRadius: 1,
    marginHorizontal: 2,
  },

  // Voice confirmation
  voiceConfirmList: {
    gap: 6,
  },
  voiceConfirmItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
  },
  voiceConfirmItemText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#101828",
    flex: 1,
  },
  voiceConfirmItemQty: {
    fontSize: 13,
    fontWeight: "700",
    color: "#667085",
  },

  // Summary button
  summaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1570EF",
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 2,
  },
  summaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Summary modal
  summaryPersonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECF0",
    backgroundColor: "#F9FAFB",
    padding: 12,
    marginBottom: 8,
  },
  summaryPersonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryPersonInitials: {
    fontSize: 14,
    fontWeight: "700",
  },
  summaryPersonInfo: {
    flex: 1,
    gap: 2,
  },
  summaryPersonName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#101828",
  },
  summaryPersonMeta: {
    fontSize: 12,
    fontWeight: "500",
    color: "#667085",
  },
  summaryPersonTotal: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1570EF",
  },
  summaryGrandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#EAECF0",
  },
  summaryGrandTotalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#344054",
  },
  summaryGrandTotalValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#101828",
  },
  summaryDoneBtn: {
    backgroundColor: "#1570EF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  summaryDoneBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Voice tooltip
  voiceTooltipOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    justifyContent: "flex-end",
    paddingBottom: 100,
    paddingHorizontal: 20,
  },
  voiceTooltipCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#1570EF",
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#1570EF",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  voiceTooltipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#101828",
  },
  voiceTooltipDismiss: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1570EF",
  },
});

const modalStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "80%",
    overflow: "hidden",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D0D5DD",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F2F4F7",
    marginBottom: 8,
  },
  headerCloseBtn: {
    position: "absolute",
    right: 0,
    top: "50%",
    marginTop: -10,
  },
  personName: { fontSize: 18, fontWeight: "700", color: "#101828", textAlign: "center" },
  scroll: { flexGrow: 0 },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyText: { fontSize: 17, fontWeight: "700", color: "#344054" },
  emptyHint: { fontSize: 14, color: "#667085", textAlign: "center", paddingHorizontal: 16, lineHeight: 20 },
  emptySteps: {
    marginTop: 12,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    gap: 8,
    alignSelf: "stretch",
  },
  emptyStep: {
    fontSize: 14,
    color: "#475467",
    fontWeight: "500",
  },
  emptyStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  // Items
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667085",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F9FAFB",
  },
  itemLeft: { flex: 1, gap: 2 },
  itemName: { fontSize: 15, color: "#101828" },
  itemQty: { fontSize: 12, color: "#667085" },
  itemPrice: { fontSize: 15, fontWeight: "600", color: "#101828" },

  // Breakdown
  divider: { height: 1, backgroundColor: "#EAECF0", marginVertical: 12 },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  breakdownLabel: { fontSize: 14, color: "#667085", flexShrink: 1, paddingRight: 8 },
  breakdownValue: { fontSize: 14, color: "#344054", fontWeight: "500", marginLeft: 8, textAlign: "right" },
  totalRow: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#EAECF0",
  },
  totalLabel: { fontSize: 16, fontWeight: "700", color: "#101828", flexShrink: 1, paddingRight: 10 },
  totalValue: { fontSize: 16, fontWeight: "800", color: "#101828", marginLeft: 10, textAlign: "right" },

  // Transcript
  transcriptBox: {
    marginTop: 16,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  transcriptHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  transcriptLabel: { fontSize: 12, color: "#667085", fontWeight: "600" },
  transcriptText: { fontSize: 14, color: "#344054", fontStyle: "italic" },
  tipSelectorRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  tipBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  tipBtnText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
});
