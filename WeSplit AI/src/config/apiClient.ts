import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

const RAW_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? "";
const RAW_FUNCTION_API_KEY = process.env.EXPO_PUBLIC_WESPLIT_FUNCTION_API_KEY?.trim() ?? "";
const DEVICE_ID_STORAGE_KEY = "wesplit-device-id-v1";

function normalizeBaseUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    const isSecure = url.protocol === "https:";
    if (!isSecure && !(__DEV__ && isLocalHttp)) {
      return null;
    }
    return value.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const API_BASE_URL = normalizeBaseUrl(RAW_API_BASE_URL);
let cachedDeviceId: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  const existing = await SecureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
  if (existing?.trim()) {
    cachedDeviceId = existing;
    return existing;
  }

  const generated = bytesToHex(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, generated);
  cachedDeviceId = generated;
  return generated;
}

export function isBackendConfigured(): boolean {
  return API_BASE_URL !== null;
}

export function buildApiUrl(pathname: string): string | null {
  if (!API_BASE_URL) {
    return null;
  }
  if (!pathname.startsWith("/")) {
    return `${API_BASE_URL}/${pathname}`;
  }
  return `${API_BASE_URL}${pathname}`;
}

export async function getApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (RAW_FUNCTION_API_KEY) {
    headers["x-wesplit-api-key"] = RAW_FUNCTION_API_KEY;
  }

  headers["x-device-id"] = await getOrCreateDeviceId();
  return headers;
}
