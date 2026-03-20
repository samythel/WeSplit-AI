/**
 * Automated App Store Connect subscription setup via Playwright.
 *
 * Usage:
 *   npx playwright install chromium   (first time only)
 *   node scripts/setup-appstore.mjs
 *
 * The script opens a visible browser. You log in manually, then it
 * automates creating the subscription group + products.
 */

import { chromium } from "@playwright/test";

const APP_NAME = "WeSplit";
const BUNDLE_ID = "com.wesplit.app";
const SUBSCRIPTION_GROUP = "WeSplit Pro";

const PRODUCTS = [
  {
    id: "wesplit_pro_monthly",
    name: "WeSplit Pro Monthly",
    duration: "1 Month",
    price: "1.99",
    description: "Unlimited receipt scans, full history, priority AI, and ad-free experience.",
  },
  {
    id: "wesplit_pro_annual",
    name: "WeSplit Pro Annual",
    duration: "1 Year",
    price: "19.99",
    description: "Unlimited receipt scans, full history, priority AI, and ad-free experience. Save 16% vs monthly.",
  },
];

async function waitForLogin(page) {
  console.log("\n========================================");
  console.log("  PLEASE LOG IN TO APP STORE CONNECT");
  console.log("  The script will continue automatically");
  console.log("  once you're on the main dashboard.");
  console.log("========================================\n");

  // Wait until we land on the App Store Connect dashboard (up to 5 minutes for 2FA)
  await page.waitForURL("**/apps**", { timeout: 300_000 }).catch(() => {});

  // Fallback: wait for any of these selectors that appear after login
  try {
    await page.waitForSelector('[class*="app-icon"], [data-testid="app-list"], h1', {
      timeout: 300_000,
    });
  } catch {
    // If neither matched, user might already be on the right page
  }

  console.log("Login detected! Continuing with automation...\n");
  // Small buffer for page to fully load
  await page.waitForTimeout(2000);
}

async function findOrCreateApp(page) {
  console.log(`Looking for app "${APP_NAME}" (${BUNDLE_ID})...`);

  // Navigate to Apps page
  await page.goto("https://appstoreconnect.apple.com/apps");
  await page.waitForTimeout(3000);

  // Check if our app already exists
  const pageContent = await page.textContent("body");

  if (pageContent.includes(APP_NAME) || pageContent.includes(BUNDLE_ID)) {
    console.log(`Found existing app "${APP_NAME}". Clicking it...`);

    // Try clicking the app name
    const appLink = page.locator(`text="${APP_NAME}"`).first();
    if (await appLink.isVisible()) {
      await appLink.click();
      await page.waitForTimeout(3000);
      return true;
    }
  }

  console.log(`App "${APP_NAME}" not found. You may need to create it manually first.`);
  console.log("Go to: My Apps > + > New App > iOS");
  console.log(`  Name: ${APP_NAME}`);
  console.log(`  Bundle ID: ${BUNDLE_ID}`);
  console.log(`  SKU: wesplit`);
  console.log("\nWaiting for you to create the app and navigate to it...");

  // Wait until URL contains the app ID pattern
  await page.waitForURL("**/app/*/**", { timeout: 600_000 });
  await page.waitForTimeout(2000);
  return true;
}

async function navigateToSubscriptions(page) {
  console.log("Navigating to Subscriptions...");

  // Try clicking "Monetization" or "Subscriptions" in sidebar/nav
  // App Store Connect navigation can vary, try multiple approaches

  // First: look for "Monetization" in the sidebar
  const monetization = page.locator('text="Monetization"').first();
  if (await monetization.isVisible({ timeout: 3000 }).catch(() => false)) {
    await monetization.click();
    await page.waitForTimeout(2000);
  }

  // Then look for "Subscriptions"
  const subscriptions = page.locator('text="Subscriptions"').first();
  if (await subscriptions.isVisible({ timeout: 3000 }).catch(() => false)) {
    await subscriptions.click();
    await page.waitForTimeout(2000);
    return;
  }

  // Alternative: try the sidebar/tab navigation
  // App Store Connect uses different nav patterns; try the Features tab
  const features = page.locator('text="Features"').first();
  if (await features.isVisible({ timeout: 3000 }).catch(() => false)) {
    await features.click();
    await page.waitForTimeout(1000);

    const subNav = page.locator('text="Subscriptions"').first();
    if (await subNav.isVisible({ timeout: 3000 }).catch(() => false)) {
      await subNav.click();
      await page.waitForTimeout(2000);
      return;
    }
  }

  // If we can't find it programmatically, try URL-based navigation
  const currentUrl = page.url();
  const appIdMatch = currentUrl.match(/\/app\/(\d+)\//);
  if (appIdMatch) {
    const appId = appIdMatch[1];
    await page.goto(`https://appstoreconnect.apple.com/apps/${appId}/distribution/subscriptions`);
    await page.waitForTimeout(3000);
    return;
  }

  console.log("Could not auto-navigate to Subscriptions.");
  console.log("Please navigate to Monetization > Subscriptions manually.");
  console.log("Waiting...");
  await page.waitForURL("**/subscriptions**", { timeout: 300_000 });
  await page.waitForTimeout(2000);
}

async function createSubscriptionGroup(page) {
  console.log(`Creating subscription group: "${SUBSCRIPTION_GROUP}"...`);

  // Check if group already exists
  const pageContent = await page.textContent("body");
  if (pageContent.includes(SUBSCRIPTION_GROUP)) {
    console.log(`Subscription group "${SUBSCRIPTION_GROUP}" already exists. Skipping creation.`);
    // Click into the group
    const groupLink = page.locator(`text="${SUBSCRIPTION_GROUP}"`).first();
    if (await groupLink.isVisible()) {
      await groupLink.click();
      await page.waitForTimeout(2000);
    }
    return;
  }

  // Click "Create" or "+" button to create a new subscription group
  const createBtn = page.locator('button:has-text("Create"), [aria-label="Create"]').first();
  if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await createBtn.click();
    await page.waitForTimeout(1500);
  }

  // Fill in the group name
  const nameInput = page.locator('input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await nameInput.fill(SUBSCRIPTION_GROUP);
    await page.waitForTimeout(500);
  }

  // Submit / Create
  const submitBtn = page.locator('button:has-text("Create"), button:has-text("Save")').first();
  if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitBtn.click();
    await page.waitForTimeout(3000);
  }

  console.log(`Subscription group "${SUBSCRIPTION_GROUP}" created.`);
}

async function createSubscriptionProduct(page, product) {
  console.log(`Creating subscription: "${product.name}" (${product.id})...`);

  // Check if product already exists
  const pageContent = await page.textContent("body");
  if (pageContent.includes(product.id) || pageContent.includes(product.name)) {
    console.log(`Product "${product.name}" already exists. Skipping.`);
    return;
  }

  // Click "+" or "Create" to add a new subscription
  const addBtn = page.locator('button:has-text("Create"), a:has-text("Create"), [aria-label="Add"]').first();
  if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(2000);
  }

  // Fill Reference Name
  const nameInputs = page.locator('input[type="text"]');
  const count = await nameInputs.count();

  for (let i = 0; i < count; i++) {
    const input = nameInputs.nth(i);
    const placeholder = await input.getAttribute("placeholder");
    const label = await input.getAttribute("aria-label");
    const nearby = (placeholder || label || "").toLowerCase();

    if (nearby.includes("reference") || nearby.includes("name") || i === 0) {
      await input.fill(product.name);
      continue;
    }
    if (nearby.includes("product id") || nearby.includes("identifier") || i === 1) {
      await input.fill(product.id);
      continue;
    }
  }

  await page.waitForTimeout(500);

  // Try to select duration
  const durationSelect = page.locator('select').first();
  if (await durationSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await durationSelect.selectOption({ label: product.duration });
    await page.waitForTimeout(500);
  }

  // Submit
  const createBtn = page.locator('button:has-text("Create"), button:has-text("Save")').first();
  if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click();
    await page.waitForTimeout(3000);
  }

  console.log(`Product "${product.name}" created.`);

  // Try to set the price
  await setProductPrice(page, product);
}

async function setProductPrice(page, product) {
  console.log(`Setting price for "${product.name}": $${product.price}...`);

  // Look for price / pricing section
  const pricingLink = page.locator('text="Subscription Pricing", text="Price"').first();
  if (await pricingLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pricingLink.click();
    await page.waitForTimeout(2000);
  }

  // Try to find and set the price input
  const priceInput = page.locator('input[type="text"], input[type="number"]').first();
  if (await priceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await priceInput.fill(product.price);
    await page.waitForTimeout(500);
  }

  // Save
  const saveBtn = page.locator('button:has-text("Save"), button:has-text("Confirm"), button:has-text("Next")').first();
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(2000);
  }
}

async function main() {
  console.log("Launching browser...\n");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({
    viewport: null,
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    // 1. Go to App Store Connect
    await page.goto("https://appstoreconnect.apple.com");
    await page.waitForTimeout(2000);

    // 2. Wait for user to log in
    await waitForLogin(page);

    // 3. Find or create app
    await findOrCreateApp(page);

    // 4. Navigate to subscriptions
    await navigateToSubscriptions(page);

    // 5. Create subscription group
    await createSubscriptionGroup(page);

    // 6. Create subscription products
    for (const product of PRODUCTS) {
      await createSubscriptionProduct(page, product);
    }

    console.log("\n========================================");
    console.log("  SETUP COMPLETE!");
    console.log("========================================");
    console.log("\nSubscription group and products created:");
    console.log(`  Group: ${SUBSCRIPTION_GROUP}`);
    for (const p of PRODUCTS) {
      console.log(`  - ${p.name} (${p.id}): $${p.price}`);
    }
    console.log("\nPlease verify everything looks correct in the browser.");
    console.log("Press Ctrl+C to close when done.\n");

    // Keep browser open for manual verification
    await page.waitForTimeout(600_000);
  } catch (err) {
    console.error("Error during automation:", err.message);
    console.log("\nThe browser is still open. You can complete the remaining steps manually.");
    console.log("Press Ctrl+C to close.\n");
    await page.waitForTimeout(600_000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
