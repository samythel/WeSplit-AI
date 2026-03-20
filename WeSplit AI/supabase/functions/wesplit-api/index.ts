const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wesplit-api-key, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 10 MB — large enough for receipt images / audio, small enough to prevent abuse.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

// Cap prompt text fields to prevent using the endpoint as a free general-purpose LLM proxy.
const MAX_PROMPT_CHARS = 10_000;

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_GENERAL_LIMIT = 60;
const DEFAULT_STT_LIMIT = 15;

type Provider = "gemini" | "deepseek";

type ChatRequest = {
  provider?: Provider;
  system?: string;
  user?: string;
};

type VisionRequest = ChatRequest & {
  imageBase64?: string;
  mimeType?: string;
};

type SttRequest = {
  audioBase64?: string;
  mimeType?: string;
  fileName?: string;
};

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  // Pad both to the same length so comparison time is constant
  // regardless of whether lengths match.
  const maxLen = Math.max(a.length, b.length, 1);
  const paddedA = new Uint8Array(maxLen);
  const paddedB = new Uint8Array(maxLen);
  paddedA.set(a);
  paddedB.set(b);

  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= paddedA[i] ^ paddedB[i];
  }
  return mismatch === 0;
}

function readClientIp(req: Request): string {
  // Prefer platform-set headers that cannot be spoofed by the client.
  // Supabase Edge (Deno Deploy) sits behind a CDN that sets these.
  const cfIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (cfIp) {
    return cfIp;
  }
  // x-forwarded-for is less trustworthy — take only the rightmost entry
  // (the one appended by the last trusted proxy) rather than the leftmost
  // (which the client can forge).
  const xff = req.headers.get("x-forwarded-for")?.trim() ?? "";
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }
  return "unknown-ip";
}

function readClientDeviceId(req: Request): string {
  const deviceId = req.headers.get("x-device-id")?.trim() ?? "";
  return deviceId || "unknown-device";
}

function isAuthorized(req: Request): boolean {
  const expectedApiKey = Deno.env.get("WESPLIT_FUNCTION_API_KEY")?.trim() ?? "";
  if (!expectedApiKey) {
    return false;
  }

  const providedApiKey = req.headers.get("x-wesplit-api-key")?.trim() ?? "";
  if (!providedApiKey) {
    return false;
  }

  return timingSafeEqual(providedApiKey, expectedApiKey);
}

async function enforceRateLimit(req: Request, route: string): Promise<Response | null> {
  const windowMs = Math.max(1_000, Number(Deno.env.get("RATE_LIMIT_WINDOW_MS") ?? DEFAULT_WINDOW_MS));
  const generalLimit = Math.max(1, Number(Deno.env.get("RATE_LIMIT_MAX_REQUESTS") ?? DEFAULT_GENERAL_LIMIT));
  const sttLimit = Math.max(1, Number(Deno.env.get("STT_RATE_LIMIT_MAX_REQUESTS") ?? DEFAULT_STT_LIMIT));
  const limit = route === "/v1/stt/transcribe" ? sttLimit : generalLimit;
  const windowSeconds = Math.max(1, Math.floor(windowMs / 1_000));

  const ip = readClientIp(req);
  const deviceId = readClientDeviceId(req);
  const supabaseUrl = readRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Always rate-limit by IP. Additionally limit by device ID when present.
  const bucketKeys = [`${route}:ip:${ip}`];
  if (deviceId !== "unknown-device") {
    bucketKeys.push(`${route}:device:${deviceId}`);
  }

  for (const bucketKey of bucketKeys) {
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/edge_check_rate_limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        p_key: bucketKey,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });

    if (!rpcRes.ok) {
      throw new Error(`RATE_LIMIT_RPC_HTTP_${rpcRes.status}`);
    }

    const rpcJson = await rpcRes.json();
    const first = Array.isArray(rpcJson) ? rpcJson[0] : rpcJson;
    const allowed = Boolean(first?.allowed);
    const retryAfterSeconds = Number(first?.retry_after_seconds ?? 1);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please retry shortly." }),
        {
          status: 429,
          headers: {
            ...jsonHeaders,
            "Retry-After": String(Math.max(1, retryAfterSeconds)),
          },
        },
      );
    }
  }
  return null;
}

function normalizeProvider(raw: unknown): Provider {
  return raw === "deepseek" ? "deepseek" : "gemini";
}

function readRequiredEnv(key: string): string {
  const value = Deno.env.get(key)?.trim() ?? "";
  if (!value) {
    throw new Error(`MISSING_ENV_${key}`);
  }
  return value;
}

function stripModelArtifacts(rawText: string): string {
  return rawText
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

function extractJsonObject(rawText: string): unknown {
  const cleaned = stripModelArtifacts(rawText);
  if (!cleaned) {
    return null;
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

async function callGeminiChat(system: string, user: string): Promise<unknown> {
  const apiKey = readRequiredEnv("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`GEMINI_HTTP_${res.status}`);
  }

  const data = await res.json();
  const text = (data?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => String(part?.text ?? ""))
    .join("\n")
    .trim();
  return extractJsonObject(text);
}

async function callGeminiVision(system: string, user: string, imageBase64: string, mimeType: string): Promise<unknown> {
  const apiKey = readRequiredEnv("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: user },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`GEMINI_VISION_HTTP_${res.status}`);
  }

  const data = await res.json();
  const text = (data?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => String(part?.text ?? ""))
    .join("\n")
    .trim();
  return extractJsonObject(text);
}

async function callDeepSeekChat(system: string, user: string): Promise<unknown> {
  const apiKey = readRequiredEnv("DEEPSEEK_API_KEY");

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`DEEPSEEK_HTTP_${res.status}`);
  }

  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "");
  return extractJsonObject(content);
}

async function callDeepSeekVision(system: string, user: string, imageBase64: string, mimeType: string): Promise<unknown> {
  const apiKey = readRequiredEnv("DEEPSEEK_API_KEY");
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: user },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`DEEPSEEK_VISION_HTTP_${res.status}`);
  }

  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "");
  return extractJsonObject(content);
}

async function transcribeWithGladia(audioBase64: string, mimeType: string, fileName: string): Promise<string> {
  const gladiaKey = readRequiredEnv("GLADIA_API_KEY");
  const bytes = Uint8Array.from(atob(audioBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType || "audio/mp4" });
  const form = new FormData();
  form.append("audio", blob, fileName || "recording.m4a");

  const uploadRes = await fetch("https://api.gladia.io/v2/upload", {
    method: "POST",
    headers: { "x-gladia-key": gladiaKey },
    body: form,
  });
  if (!uploadRes.ok) {
    throw new Error(`GLADIA_UPLOAD_HTTP_${uploadRes.status}`);
  }

  const uploadJson = await uploadRes.json();
  const audioUrl = String(uploadJson?.audio_url ?? "");
  if (!audioUrl) {
    throw new Error("GLADIA_AUDIO_URL_MISSING");
  }

  const initRes = await fetch("https://api.gladia.io/v2/pre-recorded", {
    method: "POST",
    headers: {
      "x-gladia-key": gladiaKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audio_url: audioUrl }),
  });
  if (!initRes.ok) {
    throw new Error(`GLADIA_INIT_HTTP_${initRes.status}`);
  }

  const initJson = await initRes.json();
  const jobId = String(initJson?.id ?? "");
  if (!jobId) {
    throw new Error("GLADIA_JOB_ID_MISSING");
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pollRes = await fetch(`https://api.gladia.io/v2/pre-recorded/${jobId}`, {
      headers: { "x-gladia-key": gladiaKey },
    });
    if (!pollRes.ok) {
      throw new Error(`GLADIA_POLL_HTTP_${pollRes.status}`);
    }
    const pollJson = await pollRes.json();
    const status = String(pollJson?.status ?? "");
    if (status === "done") {
      const transcript = String(pollJson?.result?.transcription?.full_transcript ?? "").trim();
      if (!transcript) {
        throw new Error("GLADIA_TRANSCRIPT_MISSING");
      }
      return transcript;
    }
    if (status === "error") {
      throw new Error("GLADIA_JOB_ERROR");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("GLADIA_TIMEOUT");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders });
  }
  if (req.method !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  const pathname = new URL(req.url).pathname;
  const normalizedPath = pathname.includes("/v1/")
    ? pathname.slice(pathname.indexOf("/v1/"))
    : pathname;

  if (!isAuthorized(req)) {
    return response(401, { error: "Unauthorized" });
  }

  // Reject oversized payloads before reading the body.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return response(413, { error: "Payload too large" });
  }

  const rateLimited = await enforceRateLimit(req, normalizedPath);
  if (rateLimited) {
    return rateLimited;
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return response(400, { error: "Failed to read request body" });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return response(413, { error: "Payload too large" });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response(400, { error: "Invalid JSON body" });
  }

  try {
    if (normalizedPath === "/v1/ai/chat-json") {
      const body = payload as ChatRequest;
      const provider = normalizeProvider(body.provider);
      const system = String(body.system ?? "").trim();
      const user = String(body.user ?? "").trim();
      if (!system || !user) {
        return response(400, { error: "Missing system or user" });
      }
      if (system.length > MAX_PROMPT_CHARS || user.length > MAX_PROMPT_CHARS) {
        return response(400, { error: "Prompt too long" });
      }

      const result = provider === "deepseek"
        ? await callDeepSeekChat(system, user)
        : await callGeminiChat(system, user);
      if (!result) {
        return response(502, { error: "Model returned empty response" });
      }
      return response(200, { result });
    }

    if (normalizedPath === "/v1/ai/vision-json") {
      const body = payload as VisionRequest;
      const provider = normalizeProvider(body.provider);
      const system = String(body.system ?? "").trim();
      const user = String(body.user ?? "").trim();
      const imageBase64 = String(body.imageBase64 ?? "").trim();
      const mimeType = String(body.mimeType ?? "image/jpeg").trim();
      if (!system || !user || !imageBase64) {
        return response(400, { error: "Missing required fields" });
      }
      if (system.length > MAX_PROMPT_CHARS || user.length > MAX_PROMPT_CHARS) {
        return response(400, { error: "Prompt too long" });
      }

      const result = provider === "deepseek"
        ? await callDeepSeekVision(system, user, imageBase64, mimeType)
        : await callGeminiVision(system, user, imageBase64, mimeType);
      if (!result) {
        return response(502, { error: "Model returned empty response" });
      }
      return response(200, { result });
    }

    if (normalizedPath === "/v1/stt/transcribe") {
      const body = payload as SttRequest;
      const audioBase64 = String(body.audioBase64 ?? "").trim();
      const mimeType = String(body.mimeType ?? "audio/mp4").trim();
      const fileName = String(body.fileName ?? "recording.m4a").trim();
      if (!audioBase64) {
        return response(400, { error: "Missing audioBase64" });
      }

      const transcript = await transcribeWithGladia(audioBase64, mimeType, fileName);
      return response(200, { transcript });
    }

    return response(404, { error: "Unknown route" });
  } catch (error) {
    console.error("[wesplit-api]", error);
    return response(500, { error: "Internal server error" });
  }
});
