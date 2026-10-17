// Fluxo ponta a ponta do prompt mestre (§21 E2E): administrador cadastra profissional e serviço → define disponibilidade → cliente reserva pela página pública →
// a reserva aparece na agenda → cliente reagenda e cancela pelo link seguro → profissional conclui outro atendimento → quem não tem permissão não altera nada → fluxo público no celular.
import { expect, test, type Page } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL } from './helpers';
import { DEMO, SLUG, demoPassword, loginAs, tag } from './ag-helpers';

test.describe.configure({ mode: 'serial' });

const T = tag();
const SERVICE = `Hidratação ${T}`;
const PROF = `Pro Teste ${T}`;
const CLIENT = `Cliente E2E ${T}`;
let profId = '';
let token = '';

async function bookFirstSlot(page: Page, opts: { name: string; phone?: string; email?: string }): Promise<string> {
  await page.goto(`/agendar/${SLUG}`);
  await page.getByRole('radio', { name: new RegExp(SERVICE) }).click();
  // um único profissional habilitado: já vem selecionado e os horários carregam
  await expect(page.getByRole('listbox', { name: 'Datas com horários livres' })).toBeVisible();
  await page.getByRole('option').first().click();
  const times = page.getByRole('radiogroup', { name: /Horários em/ }).getByRole('radio');
  await expect(times.first()).toBeVisible();
  await times.first().click();
  await page.getByLabel('Nome completo').fill(opts.name);
  if (opts.phone) await page.getByLabel('Telefone / WhatsApp').fill(opts.phone);
  if (opts.email) await page.getByLabel('E-mail').fill(opts.email);
  await page.getByRole('button', { name: 'Revisar reserva' }).click();
  await expect(page.getByRole('heading', { name: '5. Revise e confirme' })).toBeVisible();
  await page.getByLabel(/Estou de acordo/).check();
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  await page.waitForURL(/\/reserva\/[A-Za-z0-9_-]{40,}\?nova=1/);
  return /\/reserva\/([A-Za-z0-9_-]+)/.exec(page.url())![1]!;
}

test('proprietário cadastra serviço e profissional e define a disponibilidade semanal', async ({ page }) => {
  await loginAs(page, DEMO.dono);
  await page.goto('/servicos?novo=1');
  await page.getByLabel('Nome', { exact: true }).fill(SERVICE);
  await page.getByLabel('Duração (min)').fill('45');
  await page.getByLabel('Intervalo depois (min)').fill('15');
  await page.getByLabel('Preço de referência (R$)').fill('90,00');
  await page.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(page.getByText('Serviço cadastrado.').first()).toBeVisible();

  await page.goto('/profissionais?novo=1');
  await page.getByLabel('Nome', { exact: true }).fill(PROF);
  await page.getByLabel(SERVICE).check();
  await page.getByRole('button', { name: 'Cadastrar profissional' }).click();
  await page.waitForURL('**/profissionais');
  const row = page.locator('tbody tr', { hasText: PROF });
  await expect(row).toContainText(SERVICE);
  profId = /prof=([0-9a-f-]{36})/.exec((await row.getByRole('link', { name: 'Disponibilidade' }).getAttribute('href')) ?? '')![1]!;

  // segunda 09–12 e 13–18, copiada para terça–sexta
  await page.goto(`/disponibilidade?prof=${profId}`);
  const monday = page.locator('div', { has: page.getByText('segunda-feira', { exact: true }) }).filter({ has: page.getByRole('button', { name: '+ Adicionar intervalo' }) }).last();
  await monday.getByRole('button', { name: '+ Adicionar intervalo' }).click();
  await monday.getByRole('button', { name: '+ Adicionar intervalo' }).click();
  await page.getByLabel('segunda-feira: início do intervalo 2').fill('13:00');
  await page.getByRole('button', { name: 'Copiar segunda para terça–sexta' }).click();
  await page.getByRole('button', { name: 'Salvar disponibilidade semanal' }).click();
  await expect(page.getByText(/Disponibilidade semanal salva/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('sexta-feira: início do intervalo 1')).toHaveValue('09:00');
  await expect(page.getByLabel('sábado: início do intervalo 1')).toHaveCount(0); // sábado segue fechado
});

test('cliente reserva pela página pública (sem login) e recebe o comprovante', async ({ page }) => {
  token = await bookFirstSlot(page, { name: CLIENT, phone: '(11) 98888-7777', email: `cliente.${T}@demo.exemplo` });
  await expect(page.getByRole('heading', { name: 'Sua reserva', level: 1 })).toBeVisible();
  await expect(page.getByText('Reserva confirmada!')).toBeVisible();
  await expect(page.getByText(SERVICE)).toBeVisible();
  await expect(page.getByText(PROF)).toBeVisible();
  await expect(page.getByText('Agendado').first()).toBeVisible();
  // a página do link não vaza dados pessoais nem navegação administrativa
  await expect(page.locator('body')).not.toContainText(new RegExp(`cliente\\.${T}@|98888|organization_id|${CLIENT}`));
});

test('a reserva aparece na agenda administrativa (lista e detalhes) com o histórico', async ({ page }) => {
  await loginAs(page, DEMO.recepcao);
  await page.goto(`/agendamentos?q=${encodeURIComponent(CLIENT)}&to=2099-12-31`);
  const row = page.locator('tbody tr', { hasText: CLIENT });
  await expect(row).toContainText(SERVICE);
  await expect(row).toContainText('Agendado');
  await expect(row).toContainText('Página pública');
  await row.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CLIENT);
  await expect(page.getByText('(11) 98888-7777')).toBeVisible();
  await expect(page.getByText('Reserva criada').first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Agendamento confirmado.').first()).toBeVisible();
  await expect(page.locator('main')).toContainText('Confirmado');
});

test('cliente reagenda pelo link seguro: mesmo serviço e profissional, só o horário muda', async ({ page }) => {
  await page.goto(`/reserva/${token}`);
  const before = await page.locator('dd', { hasText: /às \d{2}:\d{2}/ }).first().innerText();
  await page.getByRole('button', { name: 'Reagendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escolha o novo horário' })).toBeVisible();
  await page.getByRole('option').first().click();
  const times = page.getByRole('radiogroup', { name: /Horários em/ }).getByRole('radio');
  await expect(times.nth(2)).toBeVisible();
  await times.nth(2).click(); // um horário diferente do original
  await page.getByRole('button', { name: 'Confirmar novo horário' }).click();
  await page.waitForURL(/reagendada=1/);
  await expect(page.getByText('Reserva reagendada com sucesso.')).toBeVisible();
  const after = await page.locator('dd', { hasText: /às \d{2}:\d{2}/ }).first().innerText();
  expect(after).not.toBe(before);
  await expect(page.getByText(SERVICE)).toBeVisible();
  await expect(page.getByText(PROF)).toBeVisible();
});

test('cliente cancela pelo link: o horário é liberado e o link mostra a reserva como cancelada', async ({ page }) => {
  await page.goto(`/reserva/${token}`);
  await page.getByRole('button', { name: 'Cancelar reserva' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Sim, cancelar' }).click();
  await page.waitForURL(/cancelada=1/);
  await expect(page.getByText('Reserva cancelada. O horário foi liberado.')).toBeVisible();
  // o link continua mostrando a reserva como cancelada, sem nenhuma ação
  await page.goto(`/reserva/${token}`);
  await expect(page.getByText('Cancelado').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Reagendar|Cancelar reserva/ })).toHaveCount(0);
  expect((await page.goto(`/reserva/${'x'.repeat(43)}`))?.status()).toBe(404); // link inválido: 404
  // o registro permanece para a equipe, cancelado
  await loginAs(page, DEMO.recepcao);
  await page.goto(`/agendamentos?q=${encodeURIComponent(CLIENT)}&status=cancelled&to=2099-12-31`);
  await expect(page.locator('tbody tr', { hasText: CLIENT })).toContainText('Cancelado');
});

test('profissional conclui um atendimento SEU que já aconteceu (e só ele)', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  // atendimentos confirmados que já aconteceram (até ontem) e ainda não tiveram a conclusão registrada
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/agendamentos?status=confirmed&from=2000-01-01&to=${yesterday}`);
  const row = page.locator('tbody tr').first();
  await expect(row).toBeVisible();
  const href = await row.getByRole('link', { name: 'Abrir' }).getAttribute('href');
  await page.goto(href!);
  await expect(page.getByRole('button', { name: 'Marcar como concluído' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reagendar' })).toHaveCount(0); // profissional não remarca
  await page.getByRole('button', { name: 'Marcar como concluído' }).click();
  await expect(page.getByText('Atendimento marcado como concluído.').first()).toBeVisible();
  await expect(page.locator('main')).toContainText('Concluído');
  await expect(page.getByRole('button', { name: 'Marcar como concluído' })).toHaveCount(0);
});

test('quem não tem permissão não consegue alterar: telas 404 e API/RPC recusam', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  for (const r of ['/servicos', '/profissionais', '/disponibilidade', '/clientes', '/configuracoes', '/pagina-de-reservas', '/agendamentos/novo']) {
    expect((await page.goto(r))?.status(), r).toBe(404);
  }
  expect((await page.goto('/api/exportar/agendamentos'))?.status()).toBe(403);
  // pela API, com o token da própria Ana: nada além do que o perfil permite
  const h = async (email: string) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: demoPassword() }) });
    const tk = ((await res.json()) as { access_token: string }).access_token;
    return { apikey: ANON_KEY, authorization: `Bearer ${tk}`, 'content-type': 'application/json' };
  };
  const ana = await h(DEMO.ana);
  const org = ((await (await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=id`, { headers: ana })).json()) as Array<{ id: string }>)[0]!.id;
  const mine = (await (await fetch(`${SUPABASE_URL}/rest/v1/appointments?select=id,professional_id`, { headers: ana })).json()) as Array<{ id: string; professional_id: string }>;
  expect(new Set(mine.map((m) => m.professional_id)).size).toBe(1); // só a agenda dela
  const recepcao = await h(DEMO.recepcao);
  const all = (await (await fetch(`${SUPABASE_URL}/rest/v1/appointments?select=id,professional_id&limit=1000`, { headers: recepcao })).json()) as Array<{ id: string; professional_id: string }>;
  const foreign = all.find((x) => x.professional_id !== mine[0]!.professional_id)!;
  expect((await page.goto(`/agendamentos/${foreign.id}`))?.status()).toBe(404);
  const rpc = (fn: string, body: unknown) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: ana, body: JSON.stringify(body) });
  const cancel = await rpc('ag_set_status', { p_org: org, p_appt: foreign.id, p_action: 'complete', p_reason: null });
  expect(cancel.status).toBeGreaterThanOrEqual(400);
  expect(await cancel.text()).toMatch(/não encontrado|sem permissão/);
  expect((await rpc('ag_create_block', { p_org: org, p_prof: foreign.professional_id, p_start: '2099-01-01T10:00:00Z', p_end: '2099-01-01T11:00:00Z', p_reason: null })).status).toBeGreaterThanOrEqual(400);
  expect((await rpc('ag_save_weekly', { p_org: org, p_prof: foreign.professional_id, p_rules: [] })).status).toBeGreaterThanOrEqual(400);
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/appointments?id=eq.${foreign.id}`, { method: 'PATCH', headers: ana, body: JSON.stringify({ status: 'completed' }) });
  expect(patch.status).toBeGreaterThanOrEqual(400);
  const del = await fetch(`${SUPABASE_URL}/rest/v1/appointments?id=eq.${foreign.id}`, { method: 'DELETE', headers: ana });
  expect(del.status).toBeGreaterThanOrEqual(400);
});

test.describe('celular (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('fluxo público de reserva funciona no celular, sem rolagem horizontal', async ({ page }) => {
    await page.goto(`/agendar/${SLUG}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Estúdio Aurora');
    await page.getByRole('radio', { name: /Corte masculino/ }).click();
    await page.getByRole('radio', { name: /Carlos Eduardo/ }).click();
    await expect(page.getByRole('listbox', { name: 'Datas com horários livres' })).toBeVisible();
    await page.getByRole('option').first().click();
    await page.getByRole('radiogroup', { name: /Horários em/ }).getByRole('radio').first().click();
    await page.getByLabel('Nome completo').fill(`Mobile ${T}`);
    await page.getByLabel('E-mail').fill(`mobile.${T}@demo.exemplo`);
    await page.getByRole('button', { name: 'Revisar reserva' }).click();
    await page.getByLabel(/Estou de acordo/).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await page.waitForURL(/\/reserva\/.+nova=1/);
    await expect(page.getByText('Reserva confirmada!')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
