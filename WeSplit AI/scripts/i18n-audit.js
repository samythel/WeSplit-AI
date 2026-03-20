const fs = require("fs");
const vm = require("vm");
const path = require("path");

const messagesPath = path.resolve(__dirname, "../src/i18n/messages.ts");
const source = fs.readFileSync(messagesPath, "utf8");

const executable = source
  .replace(/export\s+const\s+/g, "const ")
  .replace(/export\s+type[\s\S]*?;\n/g, "")
  .replace(/as const;/g, ";")
  .replace(/: Partial<Record<MessageKey, string>>/g, "")
  .replace(/: Record<string, Partial<Record<MessageKey, string>>>/g, "");

const context = {};
vm.createContext(context);
vm.runInContext(
  `${executable}
this.i18nAudit = {
  enMessages,
  frMessages,
  esMessages,
  ptMessages,
  deMessages,
  itMessages,
  ruMessages,
  trMessages,
  jaMessages,
  koMessages,
  zhMessages,
  hiMessages,
  arMessages,
  daMessages,
  svMessages,
  noMessages,
};`,
  context,
);

const dictionaries = context.i18nAudit;
const en = dictionaries.enMessages;
const keys = Object.keys(en);

const allowedSameAsEnglish = new Set([
  "app.title",
  "result.button.venmo",
  "result.button.paypal",
  "bill.manual.itemPricePlaceholder",
  "bill.manual.itemQtyPlaceholder",
]);

let hasIssues = false;
console.log("i18n audit report");
console.log("=================\n");

for (const [name, dict] of Object.entries(dictionaries)) {
  if (name === "enMessages") continue;
  const locale = name.replace("Messages", "");
  const missing = keys.filter((k) => !(k in dict));
  const sameAsEnglish = keys.filter(
    (k) => dict[k] === en[k] && !allowedSameAsEnglish.has(k),
  );

  if (missing.length || sameAsEnglish.length) {
    hasIssues = true;
  }

  console.log(`${locale}`);
  console.log(`- missing keys: ${missing.length}`);
  if (missing.length) {
    console.log(`  ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " ..." : ""}`);
  }
  console.log(`- same as english: ${sameAsEnglish.length}`);
  if (sameAsEnglish.length) {
    console.log(
      `  ${sameAsEnglish.slice(0, 12).join(", ")}${sameAsEnglish.length > 12 ? " ..." : ""}`,
    );
  }
  console.log("");
}

if (hasIssues) {
  process.exitCode = 1;
}
