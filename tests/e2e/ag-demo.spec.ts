// Dados de demonstração (Estúdio Aurora): telas por perfil, números do painel batendo com a API, agenda (dia/semana/lista), reserva manual com conflito,
// remarcação pela equipe, bloqueios, exportação CSV segura, página pública (ativar/desativar, logotipo) e anonimização (LGPD).
import { expect, test } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL } from './helpers';
import { DEMO, SLUG, demoPassword, expectNoServerError, loginAs, tag } from './ag-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();

async function rest<T>(email: string, path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: demoPassword() }) });
  const tk = ((await res.json()) as { access_token: string }).access_token;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${tk}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDaysUtc = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));

test('proprietário: todas as telas abrem e o painel bate com a API (contagens independentes)', async ({ page }) => {
  await loginAs(page, DEMO.dono);
  for (const r of ['/dashboard', '/agenda', '/agendamentos', '/clientes', '/profissionais', '/servicos', '/disponibilidade', '/pagina-de-reservas', '/configuracoes']) {
    const res = await page.goto(r);
    expect(res?.status(), r).toBeLessThan(400);
    await expect(page.getByRole('heading', { level: 1 }).first(), r).toBeVisible();
    await expectNoServerError(page, r);
  }
  const from = addDaysUtc(-30);
  const to = addDaysUtc(30);
  // São Paulo é UTC−3 o ano todo: o dia local começa às 03:00Z
  const rows = await rest<Array<{ status: string }>>(DEMO.dono, `appointments?select=status&starts_at=gte.${from}T03:00:00Z&starts_at=lt.${addDaysUtc(31)}T03:00:00Z&limit=2000`);
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  await page.goto(`/dashboard?from=${from}&to=${to}`);
  const kpi = async (label: string) => (await page.getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]').innerText()).trim();
  expect(await kpi('Concluídos no período')).toBe(String(n('completed')));
  expect(await kpi('Cancelados no período')).toBe(String(n('cancelled')));
  expect(await kpi('Não comparecimentos')).toBe(String(n('no_show')));
  const comp = n('completed'); const ns = n('no_show');
  const expectedRate = comp + ns === 0 ? 'Sem dados' : `${(Math.round((ns * 1000) / (comp + ns)) / 10).toLocaleString('pt-BR')}%`;
  expect(await kpi('Taxa de não comparecimento')).toBe(expectedRate);
  await expect(page.getByRole('heading', { name: 'Próximos atendimentos' })).toBeVisible();
});

test('gestor/recepção: opera a agenda, mas não vê página de reservas nem configurações', async ({ page }) => {
  await loginAs(page, DEMO.recepcao);
  for (const r of ['/dashboard', '/agenda', '/agendamentos', '/clientes', '/profissionais', '/servicos', '/disponibilidade']) expect((await page.goto(r))?.status(), r).toBeLessThan(400);
  for (const r of ['/pagina-de-reservas', '/configuracoes']) expect((await page.goto(r))?.status(), r).toBe(404);
  await page.goto('/profissionais?novo=1');
  await expect(page.getByLabel(/Usuário vinculado/)).toHaveCount(0); // só o proprietário vincula usuários
  await expect(page.getByText('Somente o proprietário vincula um usuário ao profissional.')).toBeVisible();
});

test('profissional: vê só a própria agenda e o menu enxuto', async ({ page }) => {
  await loginAs(page, DEMO.carlos);
  await page.goto('/agenda');
  await expect(page.getByRole('link', { name: 'Clientes' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Serviços' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Agenda', exact: true }).first()).toBeVisible();
  // a agenda do dia tem uma coluna só (a dele)
  await expect(page.getByRole('region', { name: 'Agenda do dia' }).getByText('Carlos Eduardo').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agenda do dia' }).getByText('Ana Beatriz')).toHaveCount(0);
  const mine = await rest<Array<{ professional_id: string }>>(DEMO.carlos, 'appointments?select=professional_id&limit=2000');
  expect(new Set(mine.map((m) => m.professional_id)).size).toBe(1);
});

test('agenda: dia, semana e lista; navegação por data e filtro por profissional', async ({ page }) => {
  await loginAs(page, DEMO.recepcao);
  await page.goto('/agenda');
  const day = page.getByRole('region', { name: 'Agenda do dia' });
  await expect(day).toBeVisible();
  await expect(day.getByText('Ana Beatriz').first()).toBeVisible();
  await expect(day.getByText('Carlos Eduardo').first()).toBeVisible();
  await expect(day.getByText('Diana Lopes').first()).toBeVisible();
  // filtro por profissional deixa uma coluna
  await page.getByLabel('Profissional').selectOption({ label: 'Diana Lopes' });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(day.getByText('Ana Beatriz')).toHaveCount(0);
  // semana: sete colunas do mesmo profissional
  await page.getByRole('link', { name: 'Semana' }).click();
  await expect(page.getByRole('region', { name: 'Agenda da semana' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agenda da semana' }).getByText(/seg \d{2}\/\d{2}/)).toBeVisible();
  // lista dos próximos 14 dias
  await page.getByRole('link', { name: 'Lista' }).click();
  await expect(page.locator('ul li a[href^="/agendamentos/"]').first()).toBeVisible();
  // navegação: próximo dia e «Hoje»
  await page.getByRole('link', { name: 'Dia', exact: true }).click();
  await page.waitForURL(/view=day/);
  const url0 = page.url();
  await page.getByRole('link', { name: 'Próximo' }).click();
  await page.waitForURL((u) => u.toString() !== url0);
  await page.getByRole('link', { name: 'Hoje' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agenda');
});

test('reserva manual: horário tomado entre a busca e a gravação recusa com mensagem amigável; cliente novo; CSV neutraliza fórmulas', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await loginAs(a, DEMO.recepcao);
  // busca horários livres de Ana, corte masculino, amanhã+2
  const sid = await serviceId(a, 'Corte masculino');
  const pid = await profId(a, 'Ana Beatriz');
  const radios = a.locator('input[name="slot"]');
  let found = false;
  for (let n = 2; n <= 9 && !found; n++) {
    await a.goto(`/agendamentos/novo?service=${sid}&prof=${pid}&date=${addDaysUtc(n)}`);
    found = (await radios.count()) >= 5;
  }
  expect(found, 'alguma data com ≥5 horários livres de Ana').toBe(true);
  const slotValue = await radios.nth(1).getAttribute('value');
  // segunda aba reserva o MESMO horário primeiro
  const b = await ctx.newPage();
  await b.goto(a.url());
  await b.locator(`input[name="slot"][value="${slotValue}"]`).check({ force: true });
  await b.getByLabel('Nome do novo cliente').fill(`Primeiro ${T}`);
  await b.getByLabel('Telefone', { exact: true }).fill('(11) 95555-0001');
  await b.getByRole('button', { name: 'Criar agendamento' }).click();
  await b.waitForURL(/\/agendamentos\/[0-9a-f-]{36}/);
  // a primeira aba ainda mostra o horário como livre → recusa amigável, sem erro técnico
  await a.locator(`input[name="slot"][value="${slotValue}"]`).check({ force: true });
  await a.getByLabel('Nome do novo cliente').fill(`=2+2 ${T}`);
  await a.getByRole('button', { name: 'Criar agendamento' }).click();
  await expect(a.getByRole('alert').filter({ hasText: 'acabou de ser reservado' })).toBeVisible();
  await expect(a.getByLabel('Nome do novo cliente')).toHaveValue(`=2+2 ${T}`); // o que foi digitado permanece
  // escolhe outro horário e conclui: cliente com nome de fórmula
  await a.reload();
  await a.locator('input[name="slot"]').nth(3).check({ force: true });
  await a.getByLabel('Nome do novo cliente').fill(`=2+2 ${T}`);
  await a.getByRole('button', { name: 'Criar agendamento' }).click();
  await a.waitForURL(/\/agendamentos\/[0-9a-f-]{36}/);
  await expect(a.getByRole('heading', { level: 1 })).toContainText(`=2+2 ${T}`);
  // exportação: separador «;», BOM, fórmula neutralizada
  const csv = await a.request.get(`/api/exportar/agendamentos?q=${encodeURIComponent(`2+2 ${T}`)}&to=2099-12-31&from=2000-01-01`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text.split('\r\n')[0]).toContain(';');
  expect(text).toContain(`'=2+2 ${T}`);
  expect(text).not.toMatch(new RegExp(`(^|;)=2\\+2 ${T}`, 'm'));
  await ctx.close();
});

async function profId(page: import('@playwright/test').Page, name: string): Promise<string> {
  await page.goto('/profissionais');
  const href = await page.locator('tbody tr', { hasText: name }).getByRole('link', { name: 'Disponibilidade' }).getAttribute('href');
  return /prof=([0-9a-f-]{36})/.exec(href ?? '')![1]!;
}
async function serviceId(page: import('@playwright/test').Page, name: string): Promise<string> {
  const rows = await rest<Array<{ id: string; name: string }>>(DEMO.recepcao, 'services?select=id,name');
  return rows.find((r) => r.name === name)!.id;
}

test('equipe remarca um atendimento por formulário (sem arrastar) e o histórico registra', async ({ page }) => {
  await loginAs(page, DEMO.recepcao);
  await page.goto(`/agendamentos?q=${encodeURIComponent(`Primeiro ${T}`)}&to=2099-12-31&from=2000-01-01`);
  await page.locator('tbody tr', { hasText: `Primeiro ${T}` }).getByRole('link', { name: 'Abrir' }).click();
  await page.getByRole('link', { name: 'Reagendar' }).click();
  await expect(page.getByRole('heading', { name: 'Reagendar' })).toBeVisible();
  const opts = page.locator('input[name="slot"]');
  test.skip((await opts.count()) < 3, 'sem horários livres para remarcar');
  const before = await page.locator('dd', { hasText: /\d{2}\/\d{2}\/\d{4} às/ }).first().innerText();
  await opts.nth(2).check({ force: true });
  await page.getByRole('button', { name: 'Confirmar novo horário' }).click();
  await expect(page.getByText('Agendamento reagendado.').first()).toBeVisible();
  await expect(page.getByText(/Reagendado — de \d{2}:\d{2}/)).toBeVisible();
  const after = await page.locator('dd', { hasText: /\d{2}\/\d{2}\/\d{4} às/ }).first().innerText();
  expect(after).not.toBe(before);
});

test('bloqueio: recusado sobre atendimento marcado; criado e removido num horário livre', async ({ page }) => {
  await loginAs(page, DEMO.recepcao);
  const id = await profId(page, 'Diana Lopes');
  await page.goto(`/disponibilidade?prof=${id}`);
  const day = addDaysUtc(20);
  await page.getByLabel('Início — data').fill(day);
  await page.getByLabel('Início — hora').fill('09:00');
  await page.getByLabel('Fim — data').fill(day);
  await page.getByLabel('Fim — hora').fill('10:00');
  await page.getByLabel('Motivo (só a equipe vê)').fill(`Curso ${T}`);
  await page.getByRole('button', { name: 'Criar bloqueio' }).click();
  await expect(page.getByText(/Bloqueio criado|já existe um atendimento ou bloqueio/).first()).toBeVisible();
  await page.reload();
  const row = page.locator('tbody tr', { hasText: `Curso ${T}` });
  if (await row.count()) {
    await row.getByRole('button', { name: 'Remover bloqueio' }).click();
    await row.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Bloqueio removido.').first()).toBeVisible();
  }
});

test('página pública: proprietário desativa (404 para o público), reativa, personaliza e envia logotipo', async ({ page, browser }) => {
  await loginAs(page, DEMO.dono);
  await page.goto('/pagina-de-reservas');
  await page.getByLabel('Página ativa (aceita reservas)').uncheck();
  await page.getByRole('button', { name: 'Salvar página' }).click();
  await expect(page.getByText(/desativada/).first()).toBeVisible();
  const anon = await browser.newContext();
  const p = await anon.newPage();
  expect((await p.goto(`/agendar/${SLUG}`))?.status()).toBe(404);
  await page.goto('/pagina-de-reservas');
  await page.getByLabel('Página ativa (aceita reservas)').check();
  await page.getByLabel('Nome exibido').fill(`Estúdio Aurora ${T}`);
  await page.getByRole('button', { name: 'Salvar página' }).click();
  await expect(page.getByText(/ATIVA/).first()).toBeVisible();
  // logotipo PNG mínimo (1×1); texto disfarçado de imagem é recusado pelos bytes
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[name="logo"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Enviar logotipo' }).click();
  await expect(page.getByText('Logotipo atualizado.').first()).toBeVisible();
  // o formulário se limpa após o sucesso; esperar a limpeza antes de anexar o próximo arquivo
  await expect.poll(() => page.locator('input[name="logo"]').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
  await page.locator('input[name="logo"]').setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"></svg>') });
  await page.getByRole('button', { name: 'Enviar logotipo' }).click();
  await expect(page.getByText(/Formato não aceito/).first()).toBeVisible();
  await p.goto(`/agendar/${SLUG}`);
  await expect(p.getByRole('heading', { level: 1 })).toContainText(`Estúdio Aurora ${T}`);
  const logo = p.getByRole('img', { name: /Logotipo de/ });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect((await anon.request.get(`/agendar/${SLUG}/logo`)).headers()['content-type']).toBe('image/png');
  await anon.close();
});

test('LGPD: o proprietário anonimiza um cliente e os dados pessoais somem', async ({ page }) => {
  await loginAs(page, DEMO.dono);
  await page.goto(`/clientes?q=${encodeURIComponent(`Primeiro ${T}`)}`);
  await page.locator('tbody tr', { hasText: `Primeiro ${T}` }).getByRole('link', { name: 'Abrir' }).click();
  await page.getByText('Anonimizar dados pessoais (LGPD)').click();
  await page.getByLabel('Digite ANONIMIZAR para confirmar').fill('errado');
  await page.getByRole('button', { name: 'Anonimizar cliente' }).click();
  await expect(page.getByText('Digite ANONIMIZAR para confirmar.').first()).toBeVisible();
  await page.getByLabel('Digite ANONIMIZAR para confirmar').fill('ANONIMIZAR');
  await page.getByRole('button', { name: 'Anonimizar cliente' }).click();
  await page.waitForURL('**/clientes');
  await page.goto(`/clientes?q=Cliente anonimizado`);
  await expect(page.locator('tbody tr', { hasText: '(anonimizado)' }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(`Primeiro ${T}`);
});
