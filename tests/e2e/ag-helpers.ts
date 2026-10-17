import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { totp } from './helpers';

// A senha da demonstração é gerada ALEATORIAMENTE por `node scripts/seed-demo.mjs` e fica só em node_modules/.cache (nada fixo no repositório).
const CREDS = 'node_modules/.cache/ag-demo-credentials.json';
export function demoPassword(): string {
  if (process.env.E2E_DEMO_PASSWORD) return process.env.E2E_DEMO_PASSWORD;
  try { return (JSON.parse(readFileSync(CREDS, 'utf8')) as { password: string }).password; } catch { throw new Error('Rode `node scripts/seed-demo.mjs` (depois de `supabase db reset`) antes do E2E.'); }
}
export const DEMO = { dono: 'dono@demo.exemplo', recepcao: 'recepcao@demo.exemplo', ana: 'ana@demo.exemplo', carlos: 'carlos@demo.exemplo', diana: 'diana@demo.exemplo' };
export const SLUG = 'estudio-aurora';

type Cookies = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>;
const sessions = new Map<string, Cookies>();
const SECRET_FILE = 'node_modules/.cache/ag-e2e-owner-secret.txt'; // segredo TOTP do proprietário (válido até o próximo `supabase db reset`)
let ownerSecret: string | null = (() => { try { return readFileSync(SECRET_FILE, 'utf8').trim() || null; } catch { return null; } })();
const saveSecret = (s: string) => { mkdirSync('node_modules/.cache', { recursive: true }); writeFileSync(SECRET_FILE, s); };

/** Sessão reaproveitada por e-mail (o limitador de login do app barra logins repetidos da mesma conta). */
export async function loginAs(page: Page, email: string): Promise<void> {
  const cached = sessions.get(email);
  if (cached) {
    await page.context().clearCookies();
    await page.context().addCookies(cached);
    await page.goto('/dashboard');
    if (!page.url().includes('/login') && !page.url().includes('/mfa')) return;
  }
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  for (let i = 0; i < 4; i++) {
    await page.goto('/dashboard');
    const u = page.url();
    if (u.includes('/mfa/enroll')) {
      await page.getByRole('button', { name: 'Gerar QR Code' }).click();
      ownerSecret = (await page.locator('code').first().innerText()).trim();
      saveSecret(ownerSecret);
      await page.getByLabel('Código de 6 dígitos').fill(totp(ownerSecret));
      await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
      await page.waitForURL('**/dashboard');
    } else if (u.includes('/mfa/verify')) {
      if (!ownerSecret) throw new Error('proprietário já tem 2º fator e o segredo não é conhecido: rode `supabase db reset` + `node scripts/seed-demo.mjs` antes do E2E');
      await page.getByLabel('Código de 6 dígitos').fill(totp(ownerSecret));
      await page.getByRole('button', { name: 'Verificar' }).click();
      await page.waitForURL('**/dashboard');
    } else if (u.includes('/dashboard')) break;
  }
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  sessions.set(email, await page.context().cookies());
}

export const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
export async function expectNoServerError(page: Page, label: string) {
  await expect(page.locator('body'), `${label}: sem tela de erro`).not.toContainText(/Algo deu errado|Application error|Internal Server Error/);
}
/** Dados únicos por execução (o banco acumula dados entre testes do mesmo arquivo). */
export const tag = (): string => Date.now().toString().slice(-6);
