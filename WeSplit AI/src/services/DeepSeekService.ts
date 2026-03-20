/**
 * DeepSeekService — backend-proxy client for DeepSeek-powered inference.
 *
 * Used for both receipt vision analysis and voice/item matching.
 *
 * Requires EXPO_PUBLIC_API_BASE_URL pointing to your backend.
 *
 * Usage:
 *   const json = await sharedDeepSeek.chatJSON({ system, user });
 *   const json = await sharedDeepSeek.chatVisionJSON({ imageUri, system, user });
 */

import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { buildApiUrl, getApiHeaders, isBackendConfigured } from "../config/apiClient";

// ─── Config ───────────────────────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeepSeekChatOptions {
  system: string;
  user: string;
  /** Request timeout in ms (default 30 000) */
  timeoutMs?: number;
}

export interface DeepSeekVisionOptions {
  /** Local file URI of the image (e.g. from expo-image-picker / expo-camera). */
  imageUri: string;
  system: string;
  user: string;
  /** Request timeout in ms (default 60 000 — vision is slower). */
  timeoutMs?: number;
}

interface DeepSeekResponse {
  result?: unknown;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DeepSeekService {
  private static readonly chatEndpoint = "/v1/ai/chat-json";
  private static readonly visionEndpoint = "/v1/ai/vision-json";

  private resolveEndpoint(pathname: string): string | null {
    return buildApiUrl(pathname);
  }

  /**
   * Send a text chat request to DeepSeek and return parsed JSON.
   * Used for voice matching and item verification.
   * Returns null on any error so callers can fall back gracefully.
   */
  async chatJSON<T>(options: DeepSeekChatOptions): Promise<T | null> {
    const { system, user, timeoutMs = 30_000 } = options;
    if (!isBackendConfigured()) {
      console.warn("[DeepSeekService.chatJSON] missing EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const endpoint = this.resolveEndpoint(DeepSeekService.chatEndpoint);
    if (!endpoint) {
      console.warn("[DeepSeekService.chatJSON] invalid EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = await getApiHeaders();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "deepseek",
          system,
          user,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`DeepSeek API returned HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      return (data.result ?? null) as T | null;
    } catch (error) {
      console.warn("[DeepSeekService.chatJSON] request failed", error);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send a receipt image to DeepSeek Vision and return parsed JSON.
   * Bypasses native OCR entirely — the model reads the image itself.
   * Returns null on any error so callers can fall back to the regex parser.
   */
  async chatVisionJSON<T>(options: DeepSeekVisionOptions): Promise<T | null> {
    const { imageUri, system, user, timeoutMs = 60_000 } = options;
    if (!isBackendConfigured()) {
      console.warn("[DeepSeekService.chatVisionJSON] missing EXPO_PUBLIC_API_BASE_URL");
      return null;
    }

    const endpoint = this.resolveEndpoint(DeepSeekService.visionEndpoint);
    if (!endpoint) {
      console.warn("[DeepSeekService.chatVisionJSON] invalid EXPO_PUBLIC_API_BASE_URL");
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
        body: JSON.stringify({
          provider: "deepseek",
          system,
          user,
          imageBase64,
          mimeType,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`DeepSeek Vision API returned HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      return (data.result ?? null) as T | null;
    } catch (error) {
      console.warn("[DeepSeekService.chatVisionJSON] request failed", error);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Module-level singleton — shared across AiProcessor instances.
 */
export const sharedDeepSeek = new DeepSeekService();

