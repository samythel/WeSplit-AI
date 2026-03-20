export interface RawVisionItem {
  name: string;
  price: number;
  qty: number;
  unsurePrice?: boolean;
}

export interface RawVisionResult {
  is_receipt?: boolean;
  isReceipt?: boolean;
  items: RawVisionItem[];
  subtotal: number;
  tax: number;
  tip: number;
  service_fee?: number;
  serviceFee?: number;
  currency: string;
  restaurant_name?: string;
}

export interface RawVoiceResult {
  selected_items: string[];
  selected_item_quantities?: Record<string, number>;
  subtotal: number;
  tax_tip_share: number;
  grand_total: number;
}

export class AiProcessor {
  initialize(): Promise<void>;
  getVisionSystemPrompt(): string;
  getVoiceSystemPrompt(): string;
  /**
   * Send the image to backend vision inference.
   * Returns null if backend is unreachable or returns no items.
   */
  runVisionImageInference(imageUri: string, preferredCurrency: string): Promise<RawVisionResult | null>;
  runVoiceInference(transcript: string, receiptJson: RawVisionResult): Promise<RawVoiceResult>;
}
