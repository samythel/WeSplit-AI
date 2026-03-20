const REGION_TO_CURRENCY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  BR: "BRL",
  AR: "ARS",
  GB: "GBP",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  IT: "EUR",
  ES: "EUR",
  NL: "EUR",
  PT: "EUR",
  BE: "EUR",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  JP: "JPY",
  KR: "KRW",
  CN: "CNY",
  HK: "HKD",
  TW: "TWD",
  SG: "SGD",
  IN: "INR",
  ID: "IDR",
  VN: "VND",
  AU: "AUD",
  NZ: "NZD",
  ZA: "ZAR",
  TR: "TRY",
  AE: "AED",
  SA: "SAR",
  IL: "ILS",
  TH: "THB",
};

export const DEMO_RECEIPT_URI = "wesplit://demo-receipt";

export function resolveDeviceLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale || "en";
}

export function resolveLanguage(locale: string): string {
  const language = locale.split("-")[0] || "en";
  if (language === "iw") {
    return "he";
  }
  return language;
}

export function resolveCurrencyForLocale(locale: string): string {
  const region = locale.split("-")[1]?.toUpperCase();
  if (!region) {
    return "XXX";
  }
  return REGION_TO_CURRENCY[region] ?? "USD";
}
