export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  priceUncertain?: boolean;
}

export interface ReceiptAnalysis {
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number;
  serviceFee: number;
  currency: string;
  restaurantName: string;
  imageUri?: string;
}

export interface UserShare {
  selected_items: string[];
  selected_item_quantities?: Record<string, number>;
  subtotal: number;
  tax_tip_share: number;
  grand_total: number;
}

/** Distinct colors for person color-coding. Each has a bg (pastel) and fg (accent) */
export const PERSON_COLORS = [
  { bg: "#EFF8FF", fg: "#1570EF" },  // blue
  { bg: "#FCE7F3", fg: "#BE185D" },  // pink
  { bg: "#D1FAE5", fg: "#047857" },  // green
  { bg: "#FEF3C7", fg: "#B45309" },  // amber
  { bg: "#EDE9FE", fg: "#6D28D9" },  // violet
  { bg: "#FFE4E6", fg: "#BE123C" },  // rose
  { bg: "#CCFBF1", fg: "#0F766E" },  // teal
  { bg: "#FEE2E2", fg: "#B91C1C" },  // red
  { bg: "#ECFDF3", fg: "#067647" },  // emerald
  { bg: "#FDE68A", fg: "#92400E" },  // yellow
];

export interface PersonColor {
  bg: string;
  fg: string;
}

export interface Person {
  id: string;
  name: string;
  color: PersonColor;
  voiceTranscript: string;
  selectedItems: string[];
  subtotal: number;
  taxTipShare: number;
  grandTotal: number;
}
