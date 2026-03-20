import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { buildApiUrl, getApiHeaders, isBackendConfigured } from "../config/apiClient";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export class SpeechToTextService {
  private recording: any | null = null;

  private loadAudioModule(): any {
    const expoModules = (globalThis as any)?.expo?.modules;
    if (!expoModules?.ExponentAV) {
      // Guard before requiring expo-av: missing native module can throw a fatal error.
      throw new Error("ERR_RECORDING_RUNTIME_UNAVAILABLE");
    }

    try {
      // Lazy require avoids crashing app startup when expo-av is unavailable
      // in the current Expo Go runtime.
      return require("expo-av").Audio;
    } catch {
      throw new Error("ERR_AUDIO_RUNTIME_UNAVAILABLE");
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const Audio = this.loadAudioModule();
      const { granted } = await Audio.requestPermissionsAsync();
      return granted;
    } catch {
      return false;
    }
  }

  /** Start recording audio on-device. */
  async startRecording(): Promise<void> {
    const Audio = this.loadAudioModule();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    this.recording = recording;
  }

  /** Stop recording, upload to backend STT endpoint, and return transcript. */
  async stopAndTranscribe(
    onProgress?: (stage: "uploading" | "transcribing") => void,
  ): Promise<string> {
    if (!this.recording) throw new Error("ERR_NO_ACTIVE_RECORDING");
    const Audio = this.loadAudioModule();

    await this.recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = this.recording.getURI();
    this.recording = null;

    if (!uri) throw new Error("ERR_RECORDING_URI_MISSING");

    // 1. Upload audio to backend
    onProgress?.("uploading");
    const transcript = await this.transcribeViaBackend(uri);
    onProgress?.("transcribing");
    return transcript;
  }

  /** Cancel an in-progress recording without transcribing. */
  cancel() {
    if (this.recording) {
      let Audio: any = null;
      try {
        Audio = this.loadAudioModule();
      } catch {
        Audio = null;
      }
      this.recording.stopAndUnloadAsync().catch(() => {});
      Audio?.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      this.recording = null;
    }
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  private async transcribeViaBackend(fileUri: string): Promise<string> {
    if (!isBackendConfigured()) {
      throw new Error("ERR_BACKEND_API_BASE_URL_MISSING");
    }

    const endpoint = buildApiUrl("/v1/stt/transcribe");
    if (!endpoint) {
      throw new Error("ERR_BACKEND_API_BASE_URL_INVALID");
    }

    const ext = fileUri.split(".").pop()?.toLowerCase() ?? "m4a";
    const mimeType =
      ext === "wav"
        ? "audio/wav"
        : ext === "mp3"
          ? "audio/mpeg"
          : ext === "aac"
            ? "audio/aac"
            : ext === "ogg"
              ? "audio/ogg"
              : "audio/mp4";
    const fileName = `recording.${ext}`;
    const audioBase64 = await readAsStringAsync(fileUri, { encoding: EncodingType.Base64 });

    const headers = await getApiHeaders();
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        audioBase64,
        mimeType,
        fileName,
      }),
    });

    if (!res.ok) {
      throw new Error(`ERR_STT_BACKEND_FAILED_${res.status}`);
    }
    const data = asObject(await res.json()) ?? {};
    const transcript = typeof data.transcript === "string" ? data.transcript : "";
    if (!transcript.trim()) {
      throw new Error("ERR_STT_TRANSCRIPT_MISSING");
    }
    return transcript;
  }
}
