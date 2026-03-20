import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { buildApiUrl, getApiHeaders, isBackendConfigured } from "../config/apiClient";

export interface GeminiChatOptions {
  system: string;
  user: string;
  timeoutMs?: number;
}

export interface GeminiVisionOptions {
  imageUri: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

interface GeminiResponse {
  result?: unknown;
}

export class GeminiService {
  private static readonly chatEndpoint = "/v1/ai/chat-json";
  private static readonly visionEndpoint = "/v1/ai/vision-json";

  private resolveEndpoint(pathname: string): string | null {
    return buildApiUrl(pathname);
  }

  async chatJSON<T>(options: GeminiChatOptions): Promise<T | null> {
    const { system, user, timeoutMs = 30_000 } = options;
    if (!isBackendConfigured()) {
      console.warn("[GeminiService.chatJSON] missing EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const endpoint = this.resolveEndpoint(GeminiService.chatEndpoint);
    if (!endpoint) {
      console.warn("[GeminiService.chatJSON] invalid EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = await getApiHeaders();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          provider: "gemini",
          system,
          user,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini API returned HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as GeminiResponse;
      return (data.result ?? null) as T | null;
    } catch (error) {
      console.warn("[GeminiService.chatJSON] request failed", error);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chatVisionJSON<T>(options: GeminiVisionOptions): Promise<T | null> {
    const { imageUri, system, user, timeoutMs = 60_000 } = options;
    if (!isBackendConfigured()) {
      console.warn("[GeminiService.chatVisionJSON] missing EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const endpoint = this.resolveEndpoint(GeminiService.visionEndpoint);
    if (!endpoint) {
      console.warn("[GeminiService.chatVisionJSON] invalid EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const imageBase64 = await readAsStringAsync(imageUri, { encoding: EncodingType.Base64 });
    const ext = imageUri.split(".").pop()?.toLowerCase() ?? "jpeg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = await getApiHeaders();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          provider: "gemini",
          system,
          user,
          imageBase64,
          mimeType,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini Vision API returned HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as GeminiResponse;
      return (data.result ?? null) as T | null;
    } catch (error) {
      console.warn("[GeminiService.chatVisionJSON] request failed", error);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const sharedGemini = new GeminiService();
