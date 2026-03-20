import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import CryptoJS from "crypto-js";

const ENCRYPTION_KEY_ID = "wesplit.encryption-key.v1";
const IV_SEPARATOR = ":";

let cachedEncryptionKey: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
  if (existing?.trim()) {
    cachedEncryptionKey = existing;
    return existing;
  }

  const randomBytes = Crypto.getRandomBytes(32);
  const generated = bytesToHex(randomBytes);
  await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, generated);
  cachedEncryptionKey = generated;
  return generated;
}

export async function readEncryptedJson<T>(fileUri: string): Promise<T | null> {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    return null;
  }

  const encryptedPayload = await FileSystem.readAsStringAsync(fileUri);
  if (!encryptedPayload) {
    return null;
  }

  try {
    const hexKey = await getOrCreateEncryptionKey();
    const keyWords = CryptoJS.enc.Hex.parse(hexKey);

    // New format: "iv:ciphertext" with explicit IV
    if (encryptedPayload.includes(IV_SEPARATOR)) {
      const [ivHex, ciphertext] = encryptedPayload.split(IV_SEPARATOR, 2);
      const iv = CryptoJS.enc.Hex.parse(ivHex);
      const bytes = CryptoJS.AES.decrypt(ciphertext, keyWords, { iv });
      const plaintext = bytes.toString(CryptoJS.enc.Utf8);
      if (!plaintext) {
        return null;
      }
      return JSON.parse(plaintext) as T;
    }

    // Legacy v2 fallback: passphrase-based encryption (no IV separator).
    // Decrypt with old method, then re-encrypt with new format.
    const bytes = CryptoJS.AES.decrypt(encryptedPayload, hexKey);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    if (!plaintext) {
      return null;
    }
    const parsed = JSON.parse(plaintext) as T;
    writeEncryptedJson(fileUri, parsed).catch(() => {});
    return parsed;
  } catch {
    // Legacy v1 fallback: plaintext JSON, then re-encrypt in place.
    try {
      const legacyPayload = JSON.parse(encryptedPayload) as T;
      writeEncryptedJson(fileUri, legacyPayload).catch(() => {});
      return legacyPayload;
    } catch {
      return null;
    }
  }
}

export async function writeEncryptedJson(fileUri: string, value: unknown): Promise<void> {
  const hexKey = await getOrCreateEncryptionKey();
  const keyWords = CryptoJS.enc.Hex.parse(hexKey);
  const iv = CryptoJS.lib.WordArray.random(16);
  const serialized = JSON.stringify(value);
  const ciphertext = CryptoJS.AES.encrypt(serialized, keyWords, { iv }).toString();
  const payload = CryptoJS.enc.Hex.stringify(iv) + IV_SEPARATOR + ciphertext;
  await FileSystem.writeAsStringAsync(fileUri, payload);
}
