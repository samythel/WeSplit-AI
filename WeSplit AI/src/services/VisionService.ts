import { AiProcessor } from "./AiProcessor";
import { ReceiptAnalysis } from "../types/billing";

export class VisionService {
  private readonly aiProcessor = new AiProcessor();

  readonly systemInstruction = this.aiProcessor.getVisionSystemPrompt();

  async analyzeReceipt(imageUri: string, preferredCurrency: string): Promise<ReceiptAnalysis> {
    const result = await this.aiProcessor.runVisionImageInference(imageUri, preferredCurrency);
    if (result && (result as { is_receipt?: boolean; isReceipt?: boolean }).is_receipt === false) {
      throw new Error("ERR_VISION_NON_RECEIPT");
    }
    if (!result || result.items.length === 0) {
      throw new Error("ERR_VISION_NO_ITEMS");
    }
    const normalizedServiceFee = Number(result.service_fee ?? result.serviceFee ?? 0);

    return {
      items: result.items.map((item, index) => ({
        id: `receipt-item-${index + 1}`,
        name: item.name,
        quantity: Math.max(1, Math.floor(Number.isFinite(item.qty) ? item.qty : 1)),
        unitPrice: item.price,
        priceUncertain: Boolean(item.unsurePrice),
      })),
      subtotal: result.subtotal,
      tax: result.tax,
      tip: result.tip,
      serviceFee: Number.isFinite(normalizedServiceFee) ? normalizedServiceFee : 0,
      currency: result.currency,
      restaurantName: result.restaurant_name ?? "",
      imageUri,
    };
  }
}
