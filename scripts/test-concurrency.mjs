#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova (§11 e §21 do prompt mestre): duas solicitações para o mesmo profissional e horário → só uma é aceita; reserva × bloqueio disputam o mesmo espaço;
// remarcações para o mesmo horário têm um vencedor e preservam o original do perdedor; duplo envio da reserva pública é idempotente;
// alterar disponibilidade/bloqueio obedece ao mesmo protocolo de trava das reservas (quem chega depois espera e é validado de novo).
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-ag-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a0';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina — as sessões entram AO MESMO TEMPO.
const GUN_KEY = 7777011;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, { role = 'owner' } = {}) {
  const head = role === 'owner'
    ? `select set_config('request.jwt.claims', '{"sub":"${OWNER}","aal":"aal2","email":"oa@t.invalid"}', true); set local role authenticated;`
    : role === 'anon' ? `select set_config('request.jwt.claims', '', true); set local role anon;` : '';
  const wrapped = `begin; ${head} ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const t0 = Date.now();
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - t0 }));
    p.stdin.end(wrapped);
  });
}
const raw = (sql) => new Promise((resolve) => {
  const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  p.stdin.end(sql);
});
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await raw("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, opts) => { const r = await psql(sql, opts); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const fire = async (n, make) => { await armGun(); const rs = await Promise.all(Array.from({ length: n }, (_, k) => make(k))); gunOn = false; await new Promise((r) => setTimeout(r, GUN_MS + 200)); return rs; };
const oks = (rs) => rs.filter((r) => r.code === 0).length;
let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };
const why = (rs, n) => { if (oks(rs) !== n) console.log('   motivo: ' + rs.find((r) => r.code !== 0)?.err.split('\n')[0]); };
const friendly = (r) => /acabou de ser reservado/.test(r.err);

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).filter((x) => x.endsWith('.sql')).sort().map((x) => `migrations/${x}`)]) {
    const r = await raw(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  await raw(`insert into auth.users (id, email) values ('${OWNER}', 'oa@t.invalid')`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-ag')`);
  const O = `'${org}'`;
  const prof = await one(`select public.ag_save_professional(${O}, null, 'Profissional Conc', null, '#2563eb', true, null)`);
  const prof2 = await one(`select public.ag_save_professional(${O}, null, 'Profissional Dois', null, '#16a34a', true, null)`);
  const svc = await one(`select public.ag_save_service(${O}, null, 'Serviço Conc', null, 30, 0, 0, null, true, true)`);
  await one(`select public.ag_set_professional_services(${O}, '${prof}', array['${svc}']::uuid[])`);
  await one(`select public.ag_set_professional_services(${O}, '${prof2}', array['${svc}']::uuid[])`);
  const week = `(select jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '18:00')) from generate_series(0, 6) d)`;
  await one(`select public.ag_save_weekly(${O}, '${prof}', ${week})`);
  await one(`select public.ag_save_weekly(${O}, '${prof2}', ${week})`);
  await one(`select public.ag_save_settings(${O}, '{"public_booking_enabled":true}')`);
  // instante do horário LOCAL «HH:MM» em hoje+n (America/Sao_Paulo)
  const at = (n, hhmm) => `((private.ag_today(${O}) + ${n} + time '${hhmm}') at time zone 'America/Sao_Paulo')`;
  const book = (p, n, hhmm, who) => `select public.ag_create_appointment(${O}, '${p}', '${svc}', null, '{"name":"${who}"}', ${at(n, hhmm)}, null)`;

  console.log('> 8 sessões reservam o MESMO profissional e horário ao mesmo tempo');
  const r1 = await fire(8, (k) => psql(book(prof, 3, '10:00', `Cliente ${k}`)));
  check(oks(r1) === 1, 'somente UMA reserva é aceita');
  check(r1.filter((r) => r.code !== 0).every(friendly), 'as perdedoras recebem a mensagem amigável («acabou de ser reservado»)');
  check((await one(`select count(*) from public.appointments where starts_at = ${at(3, '10:00')}`)) === '1', 'exatamente um compromisso no horário');
  check((await one(`select count(*) from public.customers`)) === '1', 'as reservas recusadas não deixaram clientes órfãos');

  console.log('> reserva × bloqueio no mesmo espaço, 6 sessões misturadas');
  const r2 = await fire(6, (k) => psql(k % 2 === 0
    ? book(prof, 4, '14:00', `Cliente B${k}`)
    : `select public.ag_create_block(${O}, '${prof}', ${at(4, '14:00')}, ${at(4, '14:30')}, 'bloqueio ${k}')`));
  check(oks(r2) === 1, 'reservas e bloqueios disputam o mesmo espaço: só UM vence');
  check((await one(`select count(*) from public.schedule_entries where active and occupied_start_at = ${at(4, '14:00')}`)) === '1', 'uma única ocupação ativa no horário');

  console.log('> remarcações de compromissos diferentes para o MESMO horário livre');
  const a = await one(book(prof, 5, '09:00', 'Cliente R1'));
  const b = await one(book(prof, 5, '11:00', 'Cliente R2'));
  const c = await one(book(prof, 5, '13:00', 'Cliente R3'));
  const r3 = await fire(3, (k) => psql(`select public.ag_reschedule_appointment(${O}, '${[a, b, c][k]}', ${at(5, '16:00')}, null)`));
  check(oks(r3) === 1, 'somente UMA remarcação vence');
  check(r3.filter((r) => r.code !== 0).every(friendly), 'as perdedoras recebem a mensagem amigável');
  check((await one(`select count(*) from public.appointments where id in ('${a}','${b}','${c}') and starts_at = ${at(5, '16:00')}`)) === '1', 'um compromisso no novo horário');
  check((await one(`select count(*) from public.appointments where id in ('${a}','${b}','${c}') and starts_at in (${at(5, '09:00')}, ${at(5, '11:00')}, ${at(5, '13:00')})`)) === '2', 'os outros dois permaneceram nos horários originais');

  console.log('> duplo envio da reserva pública (mesma chave) em 8 sessões');
  const idem = (await one(`select gen_random_uuid()`));
  const tok = randomBytes(32).toString('hex');
  const t6 = `'${await one(`select ${at(6, '10:00')}`)}'::timestamptz`;
  const t7 = `'${await one(`select ${at(7, '10:00')}`)}'::timestamptz`;
  const pub = () => psql(`select public.ag_public_book('empresa-conc-ag', '${svc}', '${prof}', ${t6}, 'Maria Pública', '(11) 91234-5678', null, true, '${idem}', '${tok}', null)`, { role: 'anon' });
  const r4 = await fire(8, () => pub());
  why(r4, 8);
  check(oks(r4) === 8, 'todas as 8 chamadas terminam bem (reenvio devolve a mesma reserva)');
  check((await one(`select count(*) from public.appointments where source = 'public'`)) === '1', 'exatamente UMA reserva pública');
  check((await one(`select count(*) from public.customers where name = 'Maria Pública'`)) === '1', 'exatamente UM cliente criado');
  check((await raw(`select count(*) from public.booking_management_tokens`)).out === '1', 'exatamente UM link de gerenciamento');

  console.log('> clientes públicos diferentes disputam o mesmo horário (6 sessões)');
  const r5 = await fire(6, (k) => psql(`select public.ag_public_book('empresa-conc-ag', '${svc}', '${prof}', ${t7}, 'Pessoa ${k} Pública', '(11) 9000${k}-0000', null, true, gen_random_uuid(), '${randomBytes(32).toString('hex')}', null)`, { role: 'anon' }));
  why(r5, 1);
  check(oks(r5) === 1, 'somente UMA reserva pública vence');
  check(r5.filter((r) => r.code !== 0).every(friendly), 'perdedoras recebem a mensagem amigável');
  check((await one(`select count(*) from public.customers where name like 'Pessoa % Pública'`)) === '1', 'as recusadas não criaram clientes');

  console.log('> cancelar e reagendar o mesmo compromisso ao mesmo tempo (estado sempre consistente)');
  const x = await one(book(prof, 8, '10:00', 'Cliente X'));
  const r6 = await fire(2, (k) => psql(k === 0 ? `select public.ag_set_status(${O}, '${x}', 'cancel', 'teste')` : `select public.ag_reschedule_appointment(${O}, '${x}', ${at(8, '15:00')}, null)`));
  check(oks(r6) >= 1, 'pelo menos uma das operações conclui');
  check((await one(`select count(*) from public.appointments a join public.schedule_entries e on e.id = a.schedule_entry_id where a.id = '${x}' and e.active <> (a.status <> 'cancelled')`)) === '0', 'a ocupação sempre acompanha o status (sem ocupação fantasma)');
  check((await one(`select count(*) from public.schedule_entries e where e.kind = 'appointment' and e.active and not exists (select 1 from public.appointments a where a.schedule_entry_id = e.id and a.status <> 'cancelled')`)) === '0', 'nenhuma ocupação ativa sem compromisso ativo');

  console.log('> bloqueio em andamento segura quem tenta reservar o mesmo profissional (mesmo protocolo de trava)');
  const blockSession = psql(`select public.ag_create_block(${O}, '${prof}', ${at(9, '10:00')}, ${at(9, '12:00')}, 'longo'); select pg_sleep(4)`);
  await new Promise((r) => setTimeout(r, 1200));
  const waiter = await psql(book(prof, 9, '10:30', 'Cliente Espera'));
  const blk = await blockSession;
  check(blk.code === 0, 'o bloqueio foi criado');
  check(waiter.code !== 0 && friendly(waiter), 'a reserva concorrente foi recusada com a mensagem amigável');
  check(waiter.ms >= 1500, `a reserva ESPEROU a transação do bloqueio (${waiter.ms} ms) em vez de passar por cima`);

  console.log('> mudança de disponibilidade em andamento segura quem tenta reservar');
  const changer = psql(`select public.ag_save_weekly(${O}, '${prof2}', '[]'); select pg_sleep(4)`);
  await new Promise((r) => setTimeout(r, 1200));
  const waiter2 = await psql(book(prof2, 10, '10:00', 'Cliente Espera 2'));
  const chg = await changer;
  check(chg.code === 0, 'a disponibilidade foi alterada');
  check(waiter2.code !== 0 && /não está disponível/.test(waiter2.err), 'a reserva foi validada DEPOIS da mudança e recusada');
  check(waiter2.ms >= 1500, `a reserva esperou a mudança de disponibilidade (${waiter2.ms} ms)`);

  console.log('> invariantes finais');
  const overlap = await one(`select count(*) from public.schedule_entries a join public.schedule_entries b on a.id < b.id and a.professional_id = b.professional_id and a.active and b.active and tstzrange(a.occupied_start_at, a.occupied_end_at, '[)') && tstzrange(b.occupied_start_at, b.occupied_end_at, '[)')`);
  check(overlap === '0', 'nenhuma sobreposição ativa na agenda inteira');
} catch (e) {
  console.error(String(e.message ?? e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);
