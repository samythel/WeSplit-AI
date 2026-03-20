import { AiProcessor } from "./AiProcessor";
import { ReceiptAnalysis, UserShare } from "../types/billing";

export function calculateProportionalTaxTipShare(
  userSubtotal: number,
  totalSubtotal: number,
  totalTax: number,
  totalTip: number,
  totalServiceFee: number = 0,
): number {
  if (totalSubtotal <= 0 || userSubtotal <= 0) {
    return 0;
  }

  return userSubtotal * ((totalTax + totalTip + totalServiceFee) / totalSubtotal);
}

export class VoiceMatchingService {
  private readonly aiProcessor = new AiProcessor();

  readonly systemInstruction = this.aiProcessor.getVoiceSystemPrompt();

  async matchVoiceAndCalculate(transcript: string, receipt: ReceiptAnalysis): Promise<UserShare> {
    const voiceOutput = await this.aiProcessor.runVoiceInference(transcript, {
      items: receipt.items.map((item) => ({
        name: item.name,
        price: item.unitPrice,
        qty: item.quantity,
      })),
      subtotal: receipt.subtotal,
      tax: receipt.tax,
      tip: receipt.tip,
      currency: receipt.currency,
      restaurant_name: receipt.restaurantName,
    });

    // Recompute share in TS as the app-side source of truth.
    const proportionalShare = calculateProportionalTaxTipShare(
      voiceOutput.subtotal,
      receipt.subtotal,
      receipt.tax,
      receipt.tip,
      receipt.serviceFee,
    );

    return {
      selected_items: voiceOutput.selected_items,
      selected_item_quantities: voiceOutput.selected_item_quantities,
      subtotal: voiceOutput.subtotal,
      tax_tip_share: proportionalShare,
      grand_total: voiceOutput.subtotal + proportionalShare,
    };
  }
}
