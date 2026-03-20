import { ReactNode, createContext, useContext, useMemo, useState } from "react";
import { dictionaries, enMessages, MessageKey } from "./messages";
import {
  resolveCurrencyForLocale,
  resolveDeviceLocale,
  resolveLanguage,
} from "../config/runtimeDefaults";

type Params = Record<string, string | number>;

interface I18nContextValue {
  locale: string;
  language: string;
  setLanguage: (language: string) => void;
  defaultCurrency: string;
  t: (key: MessageKey, params?: Params) => string;
  formatCurrency: (value: number, currency: string) => string;
  formatDateTime: (value: number | Date) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function interpolate(template: string, params?: Params): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [deviceLocale] = useState<string>(resolveDeviceLocale());
  const [language, setLanguage] = useState<string>(() => resolveLanguage(deviceLocale));
  const locale = useMemo(() => {
    if (language === "fr") {
      return "fr-FR";
    }
    if (language === "de") {
      return "de-DE";
    }
    if (language === "it") {
      return "it-IT";
    }
    if (language === "pt") {
      return "pt-PT";
    }
    if (language === "ru") {
      return "ru-RU";
    }
    if (language === "tr") {
      return "tr-TR";
    }
    if (language === "ja") {
      return "ja-JP";
    }
    if (language === "ko") {
      return "ko-KR";
    }
    if (language === "zh") {
      return "zh-CN";
    }
    if (language === "hi") {
      return "hi-IN";
    }
    if (language === "ar") {
      return "ar-SA";
    }
    if (language === "he") {
      return "he-IL";
    }
    if (language === "th") {
      return "th-TH";
    }
    if (language === "pl") {
      return "pl-PL";
    }
    if (language === "nl") {
      return "nl-NL";
    }
    if (language === "id") {
      return "id-ID";
    }
    if (language === "vi") {
      return "vi-VN";
    }
    if (language === "da") {
      return "da-DK";
    }
    if (language === "sv") {
      return "sv-SE";
    }
    if (language === "no") {
      return "nb-NO";
    }
    if (language === "es") {
      return "es-ES";
    }
    if (language === "en") {
      return "en-US";
    }
    return deviceLocale;
  }, [deviceLocale, language]);
  const defaultCurrency = resolveCurrencyForLocale(locale);

  const value = useMemo<I18nContextValue>(() => {
    const resolvedLanguage = dictionaries[language] ? language : resolveLanguage(deviceLocale);
    const dictionary = dictionaries[resolvedLanguage] ?? dictionaries.en ?? {};

    return {
      locale,
      language: resolvedLanguage,
      setLanguage,
      defaultCurrency,
      t: (key, params) => {
        const base = dictionary[key] ?? enMessages[key] ?? key;
        return interpolate(base, params);
      },
      formatCurrency: (amount, currency) =>
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
        }).format(amount),
      formatDateTime: (value) => new Date(value).toLocaleString(locale),
    };
  }, [defaultCurrency, deviceLocale, language, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return value;
}
