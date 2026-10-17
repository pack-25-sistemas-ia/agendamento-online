#!/usr/bin/env node
// Carrega a empresa de DEMONSTRAÇÃO («Estúdio Aurora», dados fictícios) no Supabase LOCAL em execução.
//   node scripts/seed-demo.mjs                      → senha aleatória (mostrada uma vez e guardada em node_modules/.cache)
//   DEMO_PASSWORD='...' node scripts/seed-demo.mjs  → senha informada por você
// Segurança: nenhuma credencial fixa fica no repositório. Recusa rodar sem o container do Supabase LOCAL (nunca toca em banco remoto).
// Depois de aplicar, confere a coerência (dentro das janelas, sem conflitos, status condizentes com as datas) e sai com erro se algo estiver errado.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'supabase', 'config.toml'), 'utf8'))?.[1];
if (!projectId) { console.error('project_id não encontrado em supabase/config.toml'); process.exit(2); }
const container = `supabase_db_${projectId}`;
const running = spawnSync('docker', ['ps', '--filter', `name=^${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
if (running.status !== 0 || running.stdout.trim() !== container) {
  console.error(`Container ${container} não está em execução. Suba o Supabase local (supabase start) e rode de novo.`);
  process.exit(2);
}
const password = process.env.DEMO_PASSWORD ?? `${randomBytes(9).toString('base64url')}-Aa1`;
if (password.length < 12) { console.error('A senha precisa ter 12 caracteres ou mais.'); process.exit(2); }

const sql = readFileSync(join(root, 'supabase', 'seed-demo.sql'), 'utf8');
const psql = (input, vars = []) => spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...vars.flatMap((v) => ['-v', v]), '-U', 'postgres', '-d', 'postgres'], { input, encoding: 'utf8' });
const r = psql(sql, [`pw=${password}`]);
if (r.status !== 0) { console.error('Falha ao aplicar a demonstração:\n' + r.stderr); process.exit(1); }

// coerência dos dados gerados
const check = psql(`
select 'sem_janela', count(*) from public.appointments a join public.professionals p on p.id = a.professional_id
 where a.status <> 'cancelled' and not exists (select 1 from private.ag_windows(a.professional_id, (a.starts_at at time zone 'America/Sao_Paulo')::date, 'America/Sao_Paulo') w
   where w.w_start <= a.starts_at - make_interval(mins => a.buffer_before_minutes_snapshot) and a.ends_at + make_interval(mins => a.buffer_after_minutes_snapshot) <= w.w_end)
union all select 'servico_incompativel', count(*) from public.appointments a where not exists (select 1 from public.professional_services ps where ps.professional_id = a.professional_id and ps.service_id = a.service_id)
union all select 'status_incoerente', count(*) from public.appointments a where (a.status in ('completed', 'no_show') and a.ends_at > now()) or (a.status in ('scheduled', 'confirmed') and a.ends_at < now() - interval '5 days')
union all select 'sobreposicao', count(*) from public.schedule_entries x join public.schedule_entries y on x.id < y.id and x.professional_id = y.professional_id and x.active and y.active and tstzrange(x.occupied_start_at, x.occupied_end_at, '[)') && tstzrange(y.occupied_start_at, y.occupied_end_at, '[)')
union all select 'compromissos', count(*) from public.appointments
union all select 'a_registrar', count(*) from public.appointments where status in ('scheduled', 'confirmed') and ends_at < now()
union all select 'futuros_ativos', count(*) from public.appointments where status in ('scheduled', 'confirmed') and starts_at > now();
`);
if (check.status !== 0) { console.error('Falha na conferência:\n' + check.stderr); process.exit(1); }
const rows = Object.fromEntries(check.stdout.split('\n').map((l) => l.trim()).filter((l) => l.includes('|')).map((l) => l.split('|').map((x) => x.trim())));
const bad = ['sem_janela', 'servico_incompativel', 'status_incoerente', 'sobreposicao'].filter((k) => rows[k] !== '0');
if (bad.length || Number(rows.compromissos) < 30 || Number(rows.futuros_ativos) < 5 || Number(rows.a_registrar) < 2) {
  console.error('Demonstração incoerente:', JSON.stringify(rows));
  process.exit(1);
}
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
writeFileSync(join(root, 'node_modules', '.cache', 'ag-demo-credentials.json'), JSON.stringify({ password, users: ['dono', 'recepcao', 'ana', 'carlos', 'diana'].map((u) => `${u}@demo.exemplo`) }));
console.log(`Demonstração carregada: ${rows.compromissos} compromissos (${rows.futuros_ativos} futuros ativos), sem conflitos.`);
console.log('Usuários (@demo.exemplo): dono (proprietário), recepcao (gestor), ana, carlos, diana (profissionais).');
console.log(`Senha desta instalação: ${password}`);
console.log('(Guardada só em node_modules/.cache. O proprietário cadastra o 2º fator no primeiro acesso. Página pública: /agendar/estudio-aurora)');
