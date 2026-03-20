const fs = require("fs");
const path = require("path");

const targetPath = path.resolve(__dirname, "../src/i18n/messages.ts");
const source = fs.readFileSync(targetPath, "utf8");

let result = "";
let inString = false;
let escaped = false;

for (let index = 0; index < source.length; index += 1) {
  const char = source[index];

  if (inString) {
    if (char === "\n") {
      result += "\\n";
      continue;
    }
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === "\"") {
      result += char;
      inString = false;
      continue;
    }
    result += char;
    continue;
  }

  if (char === "\"") {
    inString = true;
  }
  result += char;
}

fs.writeFileSync(targetPath, result, "utf8");
console.log("escaped multiline string literals");
