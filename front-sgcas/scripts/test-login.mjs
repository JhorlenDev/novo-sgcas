import { chromium } from "@playwright/test";

const input = await new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => resolve(data));
});

const { email, password } = JSON.parse(input);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

const page = await browser.newPage();
page.on("console", (message) => {
  const text = message.text();
  if (!text.includes("Download the React DevTools")) {
    console.log("console", message.type(), text);
  }
});
page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("/api/auth/") || url.includes("/protocol/openid-connect/token")) {
    console.log("response", response.status(), url.replace(/code=[^&]+/g, "code=<redacted>"));
  }
});

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /entrar com tef[eé] cidad[aã]o/i }).click();

await page.waitForLoadState("domcontentloaded");

const username = page.locator('input[name="username"], input#username, input[type="email"]').first();
await username.waitFor({ timeout: 15000 });
await username.fill(email);

const passwordInput = page.locator('input[name="password"], input#password, input[type="password"]').first();
if (!(await passwordInput.isVisible().catch(() => false))) {
  await page.keyboard.press("Enter");
}

await passwordInput.waitFor({ timeout: 30000 }).catch(async (error) => {
  console.log("stuck_url", page.url());
  console.log("stuck_body", (await page.locator("body").innerText()).slice(0, 1200));
  throw error;
});
await passwordInput.fill(password);

const submit = page.locator('input[type="submit"], button[type="submit"], button:has-text("Entrar"), button:has-text("Sign in")').first();
await submit.click();

await page.waitForURL(/localhost:3000/, { timeout: 30000 }).catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});

console.log("final_url", page.url());
console.log("title", await page.title());

const body = (await page.locator("body").innerText()).slice(0, 800);
console.log("body", body.replace(password, "<redacted>"));

if (process.env.SCREENSHOT_PATH) {
  await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
}

await browser.close();
