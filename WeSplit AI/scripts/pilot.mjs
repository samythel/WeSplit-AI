import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: false, slowMo: 200, args: ["--start-maximized"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const page = await context.newPage();

await page.goto("https://appstoreconnect.apple.com/apps");
await page.waitForTimeout(3000);

// Take initial screenshot
await page.screenshot({ path: "/tmp/asc_screen.png", fullPage: false });
console.log("SCREENSHOT_SAVED:/tmp/asc_screen.png");

// Keep alive and wait for commands via stdin
process.stdin.setEncoding("utf-8");

async function runCommand(rawCommand) {
  if (rawCommand === "screenshot") {
    await page.screenshot({ path: "/tmp/asc_screen.png", fullPage: false });
    console.log("SCREENSHOT_SAVED:/tmp/asc_screen.png");
    return;
  }
  if (rawCommand === "quit") {
    await browser.close();
    process.exit(0);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawCommand);
  } catch {
    throw new Error("Invalid command. Use 'screenshot', 'quit', or JSON command payload.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON command payload.");
  }

  const { action } = parsed;
  if (typeof action !== "string") {
    throw new Error("Command JSON must include string 'action'.");
  }

  switch (action) {
    case "goto": {
      if (typeof parsed.url !== "string" || !parsed.url.startsWith("https://")) {
        throw new Error("goto requires an https URL.");
      }
      await page.goto(parsed.url);
      console.log("CMD_DONE");
      return;
    }
    case "click": {
      if (typeof parsed.selector !== "string") {
        throw new Error("click requires string selector.");
      }
      await page.click(parsed.selector);
      console.log("CMD_DONE");
      return;
    }
    case "fill": {
      if (typeof parsed.selector !== "string" || typeof parsed.value !== "string") {
        throw new Error("fill requires string selector and value.");
      }
      await page.fill(parsed.selector, parsed.value);
      console.log("CMD_DONE");
      return;
    }
    case "textContent": {
      if (typeof parsed.selector !== "string") {
        throw new Error("textContent requires string selector.");
      }
      const result = await page.textContent(parsed.selector);
      console.log("RESULT:", JSON.stringify(result));
      console.log("CMD_DONE");
      return;
    }
    case "waitForTimeout": {
      const ms = Number(parsed.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) {
        throw new Error("waitForTimeout requires ms between 0 and 60000.");
      }
      await page.waitForTimeout(ms);
      console.log("CMD_DONE");
      return;
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

process.stdin.on("data", async (data) => {
  const cmd = data.trim();
  try {
    await runCommand(cmd);
  } catch (e) {
    console.log("ERROR:", e.message);
  }
});

console.log("READY - type commands");

