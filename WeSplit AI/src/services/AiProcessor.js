/**
 * AiProcessor — AI inference via backend proxy.
 *
 * Two capabilities:
 *  1. runVisionImageInference(imageUri, currency) — send image directly to
 *     backend vision inference. Bypasses native OCR entirely.
 *  2. runVoiceInference(transcript, receiptJson) — map a natural-language voice
 *     description to receipt items and compute the user's share.
 *
 * Requires EXPO_PUBLIC_API_BASE_URL in your .env file.
 */

const { sharedGemini } = require("./GeminiService");

// ─── System Prompts ──────────────────────────────────────────────────────────

const RECEIPT_PARSE_SYSTEM_PROMPT =
  "You are a receipt text parser. Given raw OCR text from a restaurant receipt, " +
  "extract all line items and totals.\n" +
  "Rules:\n" +
  "- First determine if the image is a real restaurant receipt. If not, set is_receipt to false and return empty items with numeric totals set to 0.\n" +
  "- Each item has a name, unit price (price), and quantity (qty).\n" +
  "- If quantity is not stated, assume 1.\n" +
  "- Output subtotal, tax, tip, service_fee as numbers (0 if absent).\n" +
  "- IMPORTANT: tip and service_fee are separate values. Never merge service charges into tip.\n" +
  "- Classify labels containing service terms as service_fee (examples: service, service fee, service charge, " +
  "servico, servico opcional, servico/10%, servicio, cargo por servicio, couvert, atendimento, servicio incluido, " +
  "service compris, servizio, bedienung, serviceavgift, avgift, taxe de service).\n" +
  "- Classify gratuity words as tip (examples: tip, gratuity, tips, gorjeta, propina, pourboire, trinkgeld, mancia, " +
  "bahsis, dricks, drikkepenge, чаевые, チップ, 팁, 小费, बख्शीश, الإكرامية).\n" +
  "- For Brazilian/Portuguese/Spanish receipts specifically: servicio/servico/servico opcional/servico 10% " +
  "belongs in service_fee, while gorjeta/propina belongs in tip.\n" +
  "- currency: ISO 4217 code (e.g. USD, EUR, GBP). Default USD if unknown.\n" +
  "- restaurant_name: first non-numeric line, or empty string.\n" +
  'Output ONLY valid JSON: {"is_receipt":boolean,"restaurant_name":"string","items":[{"name":"string","price":number,"qty":number}],' +
  '"subtotal":number,"tax":number,"tip":number,"service_fee":number,"currency":"string"}';

const RECEIPT_PARSE_RETRY_USER_PROMPT =
  "Analyze this receipt image again. Return strict JSON only. " +
  "If this is not a restaurant receipt, set is_receipt=false and return empty items with zero totals. " +
  "If line items are hard to read, still return one fallback item named 'Uncategorized items' " +
  "with price equal to subtotal when subtotal is present.";

const VOICE_SYSTEM_PROMPT =
  "You are a bill-splitting assistant. Given a list of receipt items and a user's " +
  "spoken description of what they ordered, identify their items and compute their share.\n" +
  "Rules:\n" +
  "- Match items by name similarity (partial matches and synonyms are fine).\n" +
  "- If the user says 'half', 'split', or '1/2', multiply that item's effective price by 0.5.\n" +
  "- selected_items: array of original item names (no price modification).\n" +
  "- selected_item_quantities: object keyed by item name with a whole-number quantity when inferable from speech. If unknown, omit the key.\n" +
  "- subtotal: sum of effective prices (after half-splits).\n" +
  "- tax_tip_share and grand_total: set to 0 (the app computes these proportionally).\n" +
  'Output ONLY valid JSON: {"selected_items":["string"],"selected_item_quantities":{"item name":number},"subtotal":number,"tax_tip_share":0,"grand_total":0}';

// ─── AiProcessor ─────────────────────────────────────────────────────────────

class AiProcessor {
  constructor() {
    // All inference (text + vision) goes through backend proxy.
    this._llm = sharedGemini;
    this._visionLlm = sharedGemini;
  }

  async initialize() {
    return Promise.resolve();
  }

  getVisionSystemPrompt() {
    return RECEIPT_PARSE_SYSTEM_PROMPT;
  }

  getVoiceSystemPrompt() {
    return VOICE_SYSTEM_PROMPT;
  }

  normalizeVisionResult(result, preferredCurrency) {
    const rawItems = Array.isArray(result?.items)
      ? result.items
      : Array.isArray(result?.line_items)
        ? result.line_items
        : [];

    const toNumber = (value, fallback = 0) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };

    const items = rawItems
      .map((item, i) => {
        const name = String(item?.name ?? item?.item ?? item?.description ?? `Item ${i + 1}`).trim();
        const qty = toNumber(item?.qty ?? item?.quantity, 1);
        const price = toNumber(
          item?.price ?? item?.unit_price ?? item?.unitPrice ?? item?.amount ?? item?.total,
          0,
        );
        return {
          name: name || `Item ${i + 1}`,
          price,
          qty: qty > 0 ? qty : 1,
          unsurePrice: Boolean(item?.unsurePrice ?? item?.priceUncertain),
        };
      })
      .filter((item) => item.name.length > 0);

    return {
      items,
      subtotal: toNumber(result?.subtotal ?? result?.sub_total),
      tax: toNumber(result?.tax),
      tip: toNumber(result?.tip),
      service_fee: toNumber(
        result?.service_fee ??
          result?.serviceFee ??
          result?.service_charge ??
          result?.serviceCharge ??
          result?.service ??
          result?.servico ??
          result?.servicio,
      ),
      currency: String(result?.currency || preferredCurrency),
      restaurant_name: String(result?.restaurant_name || result?.restaurantName || ""),
      is_receipt:
        typeof result?.is_receipt === "boolean"
          ? result.is_receipt
          : (typeof result?.isReceipt === "boolean" ? result.isReceipt : null),
    };
  }

  isLikelyReceipt(normalized) {
    if (normalized?.is_receipt === false) {
      return false;
    }
    const pricedItems = normalized.items.filter((item) => Number(item?.price) > 0);
    const hasTotals = normalized.subtotal > 0 || normalized.tax > 0 || normalized.tip > 0 || normalized.service_fee > 0;
    if (normalized?.is_receipt === true) {
      return pricedItems.length > 0 || hasTotals;
    }
    return pricedItems.length > 0 && (hasTotals || pricedItems.length >= 2);
  }

  ensureUsableVisionResult(normalized) {
    if (!this.isLikelyReceipt(normalized)) {
      return null;
    }
    if (normalized.items.length === 0 && normalized.subtotal > 0) {
      normalized.items = [
        {
          name: "Uncategorized items",
          price: normalized.subtotal,
          qty: 1,
          unsurePrice: true,
        },
      ];
    }
    return normalized.items.length > 0 ? normalized : null;
  }

  /**
   * Send the receipt image to backend vision inference.
   * No native OCR involved in the app — the backend model reads the image.
   */
  async runVisionImageInference(imageUri, preferredCurrency) {
    try {
      const firstPass = await this._visionLlm.chatVisionJSON({
        imageUri,
        system: RECEIPT_PARSE_SYSTEM_PROMPT,
        user: `Currency hint: ${preferredCurrency}\n\nAnalyze this receipt image and extract every line item, price, and total.`,
      });
      const firstNormalized = this.normalizeVisionResult(firstPass, preferredCurrency);
      if (firstNormalized.items.length > 0 && this.isLikelyReceipt(firstNormalized)) {
        return firstNormalized;
      }

      const secondPass = await this._visionLlm.chatVisionJSON({
        imageUri,
        system: RECEIPT_PARSE_SYSTEM_PROMPT,
        user: `${RECEIPT_PARSE_RETRY_USER_PROMPT}\nCurrency hint: ${preferredCurrency}`,
      });
      const secondNormalized = this.normalizeVisionResult(secondPass, preferredCurrency);
      const selected = secondNormalized.items.length > 0 ? secondNormalized : firstNormalized;

      const usable = this.ensureUsableVisionResult(selected);
      if (!usable) {
        console.warn("[AiProcessor.runVisionImageInference] vision returned no items after retry", {
          subtotal: selected.subtotal,
          tax: selected.tax,
          tip: selected.tip,
        });
        return null;
      }

      return usable;
    } catch (error) {
      console.warn("[AiProcessor.runVisionImageInference] inference failed", error);
      return null;
    }
  }

  /**
   * Match a voice transcript to receipt items using Gemini.
   */
  async runVoiceInference(transcript, receiptJson) {
    const result = await this._llm.chatJSON({
      system: VOICE_SYSTEM_PROMPT,
      user:
        `Receipt items: ${JSON.stringify(receiptJson.items)}\n` +
        `User said: "${transcript}"`,
    });

    if (!result || !Array.isArray(result.selected_items) || typeof result.subtotal !== "number") {
      throw new Error("ERR_VOICE_INVALID_RESPONSE");
    }

    const selectedItemQuantities = {};
    if (result.selected_item_quantities && typeof result.selected_item_quantities === "object") {
      for (const [itemName, rawQuantity] of Object.entries(result.selected_item_quantities)) {
        const normalizedName = String(itemName ?? "").trim();
        const numericQuantity = Number(rawQuantity);
        if (!normalizedName || !Number.isFinite(numericQuantity)) {
          continue;
        }
        const wholeQuantity = Math.floor(numericQuantity);
        if (wholeQuantity > 0) {
          selectedItemQuantities[normalizedName] = wholeQuantity;
        }
      }
    }

    return {
      selected_items: result.selected_items,
      selected_item_quantities: selectedItemQuantities,
      subtotal: result.subtotal,
      tax_tip_share: 0, // VoiceMatchingService recomputes proportionally
      grand_total: 0,
    };
  }
}

module.exports = { AiProcessor };

