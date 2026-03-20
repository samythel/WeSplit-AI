import { ReceiptAnalysis, UserShare } from "../types/billing";
import { VisionService } from "./VisionService";
import { VoiceMatchingService } from "./VoiceMatchingService";

/**
 * AIService — facade for all AI-powered features.
 *
 * All inference is handled by backend proxy endpoints (via AiProcessor / GeminiService).
 */
export class AIService {
  private readonly visionService = new VisionService();
  private readonly voiceMatchingService = new VoiceMatchingService();

  async analyzeReceipt(imageUri: string, preferredCurrency: string): Promise<ReceiptAnalysis> {
    return this.visionService.analyzeReceipt(imageUri, preferredCurrency);
  }

  async processVoiceSelection(transcript: string, receipt: ReceiptAnalysis): Promise<UserShare> {
    return this.voiceMatchingService.matchVoiceAndCalculate(transcript, receipt);
  }
}
