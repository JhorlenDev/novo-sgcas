import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de navegador das telas, com a API simulada (ver `e2e/apoio.ts`): não precisam de banco,
 * da API Django nem do Tefé Cidadão. Rodam contra o build de produção, o mesmo que vai ao servidor.
 *
 *   npm run test:e2e                              faz o build, sobe na porta 3100 e testa
 *   E2E_URL=http://localhost:3000 npm run test:e2e  usa um servidor que já está no ar
 *   PLAYWRIGHT_CHANNEL=msedge npm run test:e2e      usa o Edge instalado, em vez do Chromium do Playwright
 */
const PORTA = 3100;
const NO_CI = Boolean(process.env.CI);
const URL_EXTERNA = process.env.E2E_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: NO_CI,
  retries: NO_CI ? 1 : 0,
  reporter: NO_CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: URL_EXTERNA ?? `http://localhost:${PORTA}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    locale: "pt-BR",
    timezoneId: "America/Manaus",
    trace: "retain-on-failure",
  },
  webServer: URL_EXTERNA
    ? undefined
    : {
        // No CI o build já foi feito no passo anterior: aqui só sobe o servidor.
        command: NO_CI
          ? `npm run start -- --port ${PORTA}`
          : `npm run build && npm run start -- --port ${PORTA}`,
        url: `http://localhost:${PORTA}/login/`,
        reuseExistingServer: !NO_CI,
        timeout: 300_000,
      },
});
