const fs = require("fs");
const vm = require("vm");
const https = require("https");
const path = require("path");

const messagesPath = path.resolve(__dirname, "../src/i18n/messages.ts");

const LOCALES = [
  { key: "fr", tl: "fr" },
  { key: "es", tl: "es" },
  { key: "pt", tl: "pt" },
  { key: "de", tl: "de" },
  { key: "it", tl: "it" },
  { key: "ru", tl: "ru" },
  { key: "tr", tl: "tr" },
  { key: "ja", tl: "ja" },
  { key: "ko", tl: "ko" },
  { key: "zh", tl: "zh-CN" },
  { key: "hi", tl: "hi" },
  { key: "ar", tl: "ar" },
  { key: "da", tl: "da" },
  { key: "sv", tl: "sv" },
  { key: "no", tl: "nb" },
];

const DO_NOT_TRANSLATE_KEYS = new Set([
  "app.title",
  "result.button.venmo",
  "result.button.paypal",
  "bill.manual.itemPricePlaceholder",
  "bill.manual.itemQtyPlaceholder",
]);

function toExecutableSource(source) {
  return source
    .replace(/export\s+const\s+/g, "const ")
    .replace(/export\s+type[\s\S]*?;\n/g, "")
    .replace(/as const;/g, ";")
    .replace(/: Partial<Record<MessageKey, string>>/g, "")
    .replace(/: Record<string, Partial<Record<MessageKey, string>>>/g, "");
}

function parseDictionaries(source) {
  const executable = toExecutableSource(source);
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${executable}
this.i18nAudit = {
  en: enMessages,
  fr: frMessages,
  es: esMessages,
  pt: ptMessages,
  de: deMessages,
  it: itMessages,
  ru: ruMessages,
  tr: trMessages,
  ja: jaMessages,
  ko: koMessages,
  zh: zhMessages,
  hi: hiMessages,
  ar: arMessages,
  da: daMessages,
  sv: svMessages,
  no: noMessages,
};`,
    context,
  );
  return context.i18nAudit;
}

function protectPlaceholders(text) {
  const placeholders = [];
  const protectedText = text.replace(/\{(\w+)\}/g, (_m, name) => {
    const token = `__VAR_${placeholders.length}__`;
    placeholders.push({ token, value: `{${name}}` });
    return token;
  });
  return { protectedText, placeholders };
}

function restorePlaceholders(text, placeholders) {
  let restored = text;
  for (const { token, value } of placeholders) {
    const pattern = token
      .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
      .replace(/_/g, "[_ ]?");
    restored = restored.replace(new RegExp(pattern, "g"), value);
  }
  return restored;
}

function translateOne(text, tl) {
  return new Promise((resolve, reject) => {
    const { protectedText, placeholders } = protectPlaceholders(text);
    const q = encodeURIComponent(protectedText);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(tl)}&dt=t&q=${q}`;

    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const payload = JSON.parse(data);
            const translated = Array.isArray(payload?.[0])
              ? payload[0].map((item) => item?.[0] ?? "").join("")
              : text;
            resolve(restorePlaceholders(translated, placeholders));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function escapeTsString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function upsertLocaleOverrides(source, localeKey, entries) {
  if (!entries.length) return source;
  const constName = `${localeKey}Messages`;
  const startMarker = `export const ${constName}: Partial<Record<MessageKey, string>> = {`;
  const startIndex = source.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error(`Could not find dictionary block for ${constName}`);
  }
  const endIndex = source.indexOf("\n};", startIndex);
  if (endIndex < 0) {
    throw new Error(`Could not find end of dictionary block for ${constName}`);
  }

  const lines = entries.map(
    ([key, value]) => `  "${key}": "${escapeTsString(value)}",`,
  );
  const insertion = `\n${lines.join("\n")}`;
  return `${source.slice(0, endIndex)}${insertion}${source.slice(endIndex)}`;
}

async function main() {
  let source = fs.readFileSync(messagesPath, "utf8");
  const dictionaries = parseDictionaries(source);
  const english = dictionaries.en;
  const allKeys = Object.keys(english);

  for (const locale of LOCALES) {
    const dict = dictionaries[locale.key] ?? {};
    const keysToTranslate = allKeys.filter((key) => {
      if (DO_NOT_TRANSLATE_KEYS.has(key)) return false;
      const value = dict[key];
      if (!value) return true;
      return value === english[key];
    });

    if (keysToTranslate.length === 0) {
      console.log(`${locale.key}: no fallback keys`);
      continue;
    }

    console.log(`${locale.key}: translating ${keysToTranslate.length} keys...`);
    const translatedEntries = [];
    for (let index = 0; index < keysToTranslate.length; index += 1) {
      const key = keysToTranslate[index];
      const enText = english[key];
      try {
        const translated = await translateOne(enText, locale.tl);
        translatedEntries.push([key, translated]);
      } catch (error) {
        console.warn(`${locale.key}: failed ${key}, keeping original`, error?.message ?? error);
      }
      if ((index + 1) % 25 === 0 || index + 1 === keysToTranslate.length) {
        console.log(`${locale.key}: ${index + 1}/${keysToTranslate.length}`);
      }
    }
    source = upsertLocaleOverrides(source, locale.key, translatedEntries);
  }

  fs.writeFileSync(messagesPath, source, "utf8");
  console.log("done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
