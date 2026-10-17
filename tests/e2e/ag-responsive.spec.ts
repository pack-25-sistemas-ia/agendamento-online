// Responsividade e acessibilidade básica: nenhuma tela estoura a largura, tem título, um h1, landmark principal e campos com nome acessível.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, SLUG, loginAs } from './ag-helpers';

test.describe.configure({ mode: 'serial' });

const ADMIN = ['/dashboard', '/agenda', '/agendamentos', '/agendamentos/novo', '/clientes', '/profissionais', '/servicos', '/disponibilidade', '/pagina-de-reservas', '/configuracoes'];

async function audit(page: Page, route: string) {
  const res = await page.goto(route);
  expect(res?.status(), route).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1 }).first(), route).toBeVisible();
  const r = await page.evaluate(() => {
    const unnamed = [...document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter((el) => {
      const labelled = (el.labels && el.labels.length > 0) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
      return !labelled;
    }).map((el) => `${el.tagName.toLowerCase()}#${el.id || el.getAttribute('name') || '?'}`);
    const unlabeledButtons = [...document.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]:not([alt=""])')).length;
    const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title.trim(),
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main, [role=main]').length,
      lang: document.documentElement.lang,
      unnamed, unlabeledButtons, noAlt,
    };
  });
  expect(r.overflow, `${route}: rolagem horizontal`).toBeLessThanOrEqual(1);
  expect(r.title.length, `${route}: título da página`).toBeGreaterThan(2);
  expect(r.h1, `${route}: exatamente um h1`).toBe(1);
  expect(r.main, `${route}: landmark principal`).toBeGreaterThanOrEqual(1);
  expect(r.lang, `${route}: idioma`).toMatch(/^pt/i);
  expect(r.unnamed, `${route}: campos sem nome acessível`).toEqual([]);
  expect(r.unlabeledButtons, `${route}: botões/links sem nome`).toBe(0);
  expect(r.noAlt, `${route}: imagens sem alt`).toBe(0);
}

test('celular (375 px): proprietário percorre o painel sem rolagem horizontal e com estrutura acessível', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page, DEMO.dono);
  for (const r of ADMIN) await audit(page, r);
  await audit(page, '/agenda?view=week');
  await audit(page, '/agenda?view=list');
});

test('celular (375 px): a página pública de reservas é utilizável e não estoura a largura (sem login)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await audit(page, `/agendar/${SLUG}`);
});

test('celular (375 px): o profissional vê a própria agenda sem estourar a largura', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page, DEMO.ana);
  for (const r of ['/dashboard', '/agenda', '/agendamentos']) await audit(page, r);
});

test('tablet (768 px) e desktop largo (1440 px): painel, agenda e página pública', async ({ page }) => {
  await loginAs(page, DEMO.dono);
  for (const w of [768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const r of ['/dashboard', '/agenda', '/agenda?view=week', '/agendamentos', `/agendar/${SLUG}`]) await audit(page, r);
  }
});

test('teclado: o primeiro Tab leva a um controle visível', async ({ page }) => {
  await loginAs(page, DEMO.dono);
  await page.goto('/dashboard');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const box = el.getBoundingClientRect();
    return { visible: box.width > 0 && box.height > 0 };
  });
  expect(focused).not.toBeNull();
  expect(focused!.visible).toBe(true);
});
