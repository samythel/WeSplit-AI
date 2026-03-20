const fs = require("fs");
const path = require("path");

const messagesPath = path.resolve(__dirname, "../src/i18n/messages.ts");
let source = fs.readFileSync(messagesPath, "utf8");

const overrides = {
  fr: {
    "table.summary.total": "Total general",
    "home.menu.open": "Ouvrir le menu",
    "home.menu.title": "Menu principal",
    "detail.total": "Montant total",
  },
  es: {
    "table.summary.total": "Importe total",
    "history.entry.total": "Importe: {total}",
    "detail.total": "Importe total",
  },
  pt: {
    "table.header.item": "Produto",
    "table.summary.subtotal": "Subtotal parcial",
    "table.summary.total": "Valor total",
    "result.summary.subtotal": "Subtotal parcial",
    "home.menu.open": "Abrir menu",
    "home.menu.title": "Menu principal",
    "history.entry.total": "Valor: {total}",
    "charges.subtotal": "Subtotal parcial",
    "detail.subtotal": "Subtotal parcial",
    "detail.total": "Valor total",
  },
  de: {
    "camera.runtime.vision": "Bildanalyse: {model}",
    "camera.runtime.status": "Zustand: {status}",
    "language.option.hi": "Hindi-Sprache",
    "person.defaultName": "Teilnehmer {n}",
  },
  it: {
    "home.menu.open": "Apri menu",
    "home.menu.title": "Menu principale",
  },
  zh: {
    "receipt.tapToSnap": "点击拍照或上传小票",
    "detail.step2": "点击某人旁边的麦克风",
  },
  da: {
    "camera.runtime.vision": "Billedsyn: {model}",
    "camera.runtime.status": "Tilstand: {status}",
    "bill.voice.button.start": "Start stemme",
    "bill.manual.tipLabel": "Drikkepenge",
    "table.summary.subtotal": "Delsum",
    "table.summary.tip": "Drikkepenge",
    "table.summary.total": "Samlet belob",
    "result.summary.subtotal": "Delsum",
    "home.menu.open": "Abn menu",
    "home.menu.title": "Hovedmenu",
    "person.defaultName": "Deltager {n}",
    "charges.subtotal": "Delsum",
    "voice.stop": "Stands",
    "detail.subtotal": "Delsum",
    "detail.total": "Samlet belob",
  },
  sv: {
    "camera.runtime.vision": "Bildtolkning: {model}",
    "camera.runtime.status": "Tillstand: {status}",
    "table.summary.total": "Slutsumma",
    "person.defaultName": "Deltagare {n}",
  },
  no: {
    "camera.runtime.status": "Tilstand: {status}",
    "bill.voice.button.start": "Start stemme",
    "table.summary.total": "Sluttsum",
    "language.option.hi": "Hindi-sprak",
    "person.defaultName": "Deltaker {n}",
  },
};

function escapeTsString(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function insertOverrides(locale, dictOverrides) {
  const constName = `${locale}Messages`;
  const start = source.indexOf(`export const ${constName}: Partial<Record<MessageKey, string>> = {`);
  if (start < 0) {
    throw new Error(`Cannot find block for ${constName}`);
  }
  const end = source.indexOf("\n};", start);
  if (end < 0) {
    throw new Error(`Cannot find end block for ${constName}`);
  }
  const lines = Object.entries(dictOverrides).map(
    ([key, value]) => `  "${key}": "${escapeTsString(value)}",`,
  );
  source = `${source.slice(0, end)}\n${lines.join("\n")}${source.slice(end)}`;
}

for (const [locale, dictOverrides] of Object.entries(overrides)) {
  insertOverrides(locale, dictOverrides);
}

fs.writeFileSync(messagesPath, source, "utf8");
console.log("applied remaining overrides");
