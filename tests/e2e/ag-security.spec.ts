// Segurança do Agendamento Online contra o Supabase real: o público (anon) só alcança as 8 operações ag_public_*.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ANON_KEY, BASE_URL, SUPABASE_URL } from './helpers';
import { DEMO, SLUG, loginAs, tag } from './ag-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();

const H = { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json' };
async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const text = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* corpo vazio */ }
  return { status: r.status, body: body as Record<string, unknown> | unknown[] | null, text };
}
const token = () => randomBytes(36).toString('base64url');
const phone = () => `(11) 9${Math.floor(1_0000_0000 + Math.random() * 8_9999_9999)}`.slice(0, 16);

type Page = { services: { id: string; professionals: { id: string }[] }[] };
async function target() {
  const pg = (await rpc('ag_public_page', { p_slug: SLUG })).body as unknown as Page;
  const svc = pg.services[0]!;
  return { svc: svc.id, prof: svc.professionals[0]!.id };
}
async function freeTimes(svc: string, prof: string): Promise<string[]> {
  const from = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const r = (await rpc('ag_public_slots', { p_slug: SLUG, p_svc: svc, p_prof: prof, p_from: from, p_to: to })).body as { days: { times: string[] }[] };
  return r.days.flatMap((d) => d.times);
}

test('anon não lê nem escreve em nenhuma tabela do sistema', async () => {
  const tables = ['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries', 'appointments', 'appointment_events', 'booking_management_tokens', 'public_booking_requests', 'booking_rate_limits'];
  for (const t of tables) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=5`, { headers: H });
    const body = (await r.json().catch(() => [])) as unknown;
    const leaked = r.ok && Array.isArray(body) && body.length > 0;
    expect(leaked, `${t} não pode devolver linhas ao anon (status ${r.status})`).toBe(false);
    const w = await fetch(`${SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...H, prefer: 'return=minimal' }, body: '{}' });
    expect(w.status, `${t}: escrita direta negada`).toBeGreaterThanOrEqual(400);
  }
});

test('anon não executa RPCs administrativas nem funções internas', async () => {
  const org = randomUUID();
  const calls: [string, Record<string, unknown>][] = [
    ['ag_dashboard', { p_org: org, p_from: '2026-01-01', p_to: '2026-01-31' }],
    ['ag_slots', { p_org: org, p_prof: org, p_svc: org, p_from: '2026-01-01', p_to: '2026-01-02' }],
    ['ag_org_members', { p_org: org }],
    ['ag_set_status', { p_org: org, p_id: org, p_status: 'completed' }],
    ['ag_log_export', { p_org: org, p_kind: 'x', p_count: 1 }],
    ['ag_book', { p_org: org, p_prof: org, p_svc: org, p_cust: org, p_start: '2030-01-01T10:00:00Z', p_source: 'admin', p_notes: null, p_actor: 'admin', p_pub: false, p_meta: {} }],
  ];
  for (const [fn, args] of calls) {
    const r = await rpc(fn, args);
    expect(r.status, `${fn} não pode ser executável pelo anon`).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body ?? '')).not.toMatch(/Estúdio|Aurora/);
  }
});

test('operações públicas: página, horários, reserva com consentimento, reenvio idempotente e conflito', async () => {
  const { svc, prof } = await target();
  expect((await rpc('ag_public_page', { p_slug: 'empresa-que-nao-existe' })).body).toBeNull();
  const times = await freeTimes(svc, prof);
  expect(times.length).toBeGreaterThan(6);
  const base = { p_slug: SLUG, p_svc: svc, p_prof: prof, p_name: `Cliente Seg ${T}`, p_phone: '(11) 94444-0001', p_email: null, p_consent: true };

  // sem consentimento: recusa
  const noConsent = await rpc('ag_public_book', { ...base, p_start: times[0], p_consent: false, p_idem: randomUUID(), p_token: token() });
  expect(noConsent.status).toBeGreaterThanOrEqual(400);

  // token curto/forjado: recusa
  const weak = await rpc('ag_public_book', { ...base, p_start: times[0], p_idem: randomUUID(), p_token: 'curto' });
  expect(weak.status).toBeGreaterThanOrEqual(400);

  const idem = randomUUID();
  const tk = token();
  const first = await rpc('ag_public_book', { ...base, p_start: times[0], p_idem: idem, p_token: tk });
  expect(first.status, first.text).toBe(200);
  expect((first.body as { replayed: boolean }).replayed).toBe(false);

  // reenvio idêntico: mesma reserva, sem duplicar
  const again = await rpc('ag_public_book', { ...base, p_start: times[0], p_idem: idem, p_token: tk });
  expect(again.status, again.text).toBe(200);
  expect((again.body as { replayed: boolean }).replayed).toBe(true);
  expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id);

  // mesma chave com OUTRO conteúdo: recusa
  const tampered = await rpc('ag_public_book', { ...base, p_start: times[1], p_idem: idem, p_token: tk });
  expect(tampered.status).toBeGreaterThanOrEqual(400);

  // outro cliente tentando o MESMO horário: conflito amigável (sem vazar SQL)
  const clash = await rpc('ag_public_book', { ...base, p_name: `Outro ${T}`, p_phone: '(11) 94444-0002', p_start: times[0], p_idem: randomUUID(), p_token: token() });
  expect(clash.status).toBeGreaterThanOrEqual(400);
  expect(clash.text).not.toMatch(/schedule_entries|exclusion|violates|constraint/i);

  // o link gerenciador só funciona com o token exato
  const ok = await rpc('ag_public_get_booking', { p_token: tk });
  expect(ok.status).toBe(200);
  const bad = await rpc('ag_public_get_booking', { p_token: token() });
  expect(bad.body === null || bad.status >= 400).toBe(true);
  expect(bad.text).not.toContain(`Cliente Seg ${T}`);
});

test('limite de abuso no banco: o mesmo contato não reserva sem fim', async () => {
  const { svc, prof } = await target();
  const times = await freeTimes(svc, prof);
  const ph = phone();
  let done = 0;
  let blocked = '';
  for (const t of times) {
    const r = await rpc('ag_public_book', { p_slug: SLUG, p_svc: svc, p_prof: prof, p_start: t, p_name: `Limite ${T}`, p_phone: ph, p_email: null, p_consent: true, p_idem: randomUUID(), p_token: token() });
    if (r.status === 200) done++;
    else if (/Muitas tentativas/i.test(r.text)) { blocked = r.text; break; }
  }
  expect(done, 'reservas aceitas até o teto').toBe(6);
  expect(blocked).toMatch(/Muitas tentativas/i);
});

test('link de gerenciamento: cabeçalhos de privacidade, sem indexação, token inválido = 404 sem vazar', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/reserva/${token()}`);
  expect(res.status()).toBe(404);
  const h = res.headers();
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-robots-tag']).toMatch(/noindex/);
  expect(h['cache-control']).toMatch(/no-store/);
  expect(h['content-security-policy']).toBeTruthy();
  expect(await res.text()).not.toMatch(/Estúdio Aurora/);
});

test('XSS: nome com HTML é exibido como texto na página pública e no painel (nunca executa)', async ({ page }) => {
  const { svc, prof } = await target();
  const times = await freeTimes(svc, prof);
  const evil = `<img src=x onerror="window.__xss=1"> ${T}`;
  const tk = token();
  let id = '';
  for (const t of times.slice(10)) {
    const r = await rpc('ag_public_book', { p_slug: SLUG, p_svc: svc, p_prof: prof, p_start: t, p_name: evil, p_phone: phone(), p_email: null, p_consent: true, p_idem: randomUUID(), p_token: tk });
    if (r.status === 200) { id = (r.body as { id: string }).id; break; }
  }
  expect(id).not.toBe('');
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  // a página do link não mostra o nome do cliente (mínimo necessário)
  await page.goto(`/reserva/${tk}`);
  await expect(page.getByRole('heading', { name: 'Sua reserva' })).toBeVisible();
  expect(await page.content()).not.toContain('onerror');
  // no painel o nome aparece como TEXTO
  await loginAs(page, DEMO.dono);
  await page.goto(`/agendamentos?q=${encodeURIComponent(T)}&from=2000-01-01&to=2099-12-31`);
  await expect(page.locator('tbody tr', { hasText: '<img src=x' }).first()).toBeVisible();
  expect(await page.locator('tbody img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

test('página pública sem sessão não expõe dados internos nem o caminho do logotipo', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/agendar/${SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).not.toMatch(/service_role|internal_notes|linked_user_id|organization_id|\/storage\/v1\/object/);
  expect((await request.get(`${BASE_URL}/agendar/slug-inexistente-${T}`)).status()).toBe(404);
  expect((await request.get(`${BASE_URL}/api/exportar/agendamentos`, { maxRedirects: 0 })).status()).not.toBe(200);
});
