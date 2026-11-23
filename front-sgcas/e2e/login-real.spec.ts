import { expect, test } from "@playwright/test";

/**
 * Entrada de verdade pelo Tefé Cidadão (antes em `scripts/test-login.mjs`). Precisa de um SGCAS
 * no ar com o Keycloak configurado e de uma conta real, então fica fora do CI e só roda quando
 * as credenciais são informadas:
 *
 *   E2E_URL=https://sgcas.tefe.am.gov.br SGCAS_E2E_EMAIL=... SGCAS_E2E_SENHA=... npx playwright test login-real
 *
 * Não grave as credenciais em arquivo nem no histórico do terminal compartilhado.
 */
const EMAIL = process.env.SGCAS_E2E_EMAIL;
const SENHA = process.env.SGCAS_E2E_SENHA;

test.skip(!EMAIL || !SENHA || !process.env.E2E_URL, "login real: informe E2E_URL, SGCAS_E2E_EMAIL e SGCAS_E2E_SENHA");

test("entra pelo Tefé Cidadão e cai numa tela do SGCAS", async ({ page, baseURL }) => {
  await page.goto("/login/");
  await page.getByRole("button", { name: /entrar com tef[eé] cidad[aã]o/i }).click();

  const usuario = page.locator('input[name="username"], input#username, input[type="email"]').first();
  await usuario.waitFor({ timeout: 15_000 });
  await usuario.fill(EMAIL!);

  const senha = page.locator('input[name="password"], input#password, input[type="password"]').first();
  if (!(await senha.isVisible().catch(() => false))) await page.keyboard.press("Enter");
  await senha.waitFor({ timeout: 30_000 });
  await senha.fill(SENHA!);
  await page.locator('input[type="submit"], button[type="submit"]').first().click();

  await page.waitForURL((url) => url.href.startsWith(baseURL!), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
});
