#!/usr/bin/env node
// Teste de mutação das regras críticas (motor TypeScript E banco): quebra cada regra DE PROPÓSITO numa cópia do código
// e exige que a suíte reprove. Se alguma mutação sobreviver, falta teste.
//   suite 'unit' → vitest nos testes do motor (tests/unit/engine-*.test.ts e token.test.ts)
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais; rode SEM outra carga na máquina)
// Cada mutação aponta para a definição VIVA (as migrações não redefinem funções umas das outras).
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3] [--check]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split('|') : null;
const wanted = (m) => !only || only.some((o) => m.name.includes(o));
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

const L = 'lib/scheduling/';
// { name, file (trecho do arquivo de migração) | ts (caminho do arquivo TS), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // ---------------------------------------------------------------- motor TS: horários
  { name: 'horários: início no passado aceito', ts: `${L}slots.ts`, find: "if (startMs <= nowMs) return 'past';", replace: "if (startMs < nowMs) return 'past';" },
  { name: 'horários: antecedência mínima ignorada', ts: `${L}slots.ts`, find: 'if (startMs < nowMs + settings.minNoticeMinutes * MIN) return', replace: 'if (false) return' },
  { name: 'horários: antecedência exata recusada', ts: `${L}slots.ts`, find: 'if (startMs < nowMs + settings.minNoticeMinutes * MIN) return', replace: 'if (startMs <= nowMs + settings.minNoticeMinutes * MIN) return' },
  { name: 'horários: horizonte ignorado', ts: `${L}slots.ts`, find: 'if (startMs >= horizonEnd(nowMs, settings)) return', replace: 'if (false) return' },
  { name: 'horários: horizonte inclui o dia seguinte', ts: `${L}slots.ts`, find: "return localToInstant(addDays(today, s.horizonDays + 1), '00:00', s.tz);", replace: "return localToInstant(addDays(today, s.horizonDays + 2), '00:00', s.tz);" },
  { name: 'horários: início antes da janela aceito', ts: `${L}slots.ts`, find: 'w.startMs <= occ.startMs && occ.endMs <= w.endMs', replace: 'w.startMs - 3600000 <= occ.startMs && occ.endMs <= w.endMs' },
  { name: 'horários: fim exatamente na janela recusado', ts: `${L}slots.ts`, find: 'w.startMs <= occ.startMs && occ.endMs <= w.endMs', replace: 'w.startMs <= occ.startMs && occ.endMs < w.endMs' },
  { name: 'horários: início exatamente na janela recusado', ts: `${L}slots.ts`, find: 'w.startMs <= occ.startMs && occ.endMs <= w.endMs', replace: 'w.startMs < occ.startMs && occ.endMs <= w.endMs' },
  { name: 'horários: grade de inícios ignorada', ts: `${L}slots.ts`, find: '&& (!isPublic ||', replace: '&& (true ||' },
  { name: 'horários: adjacência conta como conflito', ts: `${L}slots.ts`, find: 'a.startMs < b.endMs && b.startMs < a.endMs', replace: 'a.startMs <= b.endMs && b.startMs <= a.endMs' },
  { name: 'horários: sobreposição parcial ignorada', ts: `${L}slots.ts`, find: 'a.startMs < b.endMs && b.startMs < a.endMs', replace: 'a.startMs === b.startMs' },
  { name: 'horários: intervalo anterior ignorado', ts: `${L}slots.ts`, find: 'startMs: startMs - svc.before * MIN, endMs', replace: 'startMs: startMs, endMs' },
  { name: 'horários: intervalo posterior ignorado', ts: `${L}slots.ts`, find: 'endMs: startMs + (svc.duration + svc.after) * MIN', replace: 'endMs: startMs + svc.duration * MIN' },
  { name: 'horários: exceção não substitui o dia', ts: `${L}slots.ts`, find: 'const spans = ov.length > 0', replace: 'const spans = false' },
  { name: 'horários: regra desativada vale', ts: `${L}slots.ts`, find: 'r.active !== false && ', replace: '' },
  { name: 'horários: regra de outro dia da semana vale', ts: `${L}slots.ts`, find: ' && r.weekday === weekdayOf(date))', replace: ')' },
  { name: 'lista: horário passado oferecido', ts: `${L}slots.ts`, find: 'if (s <= nowMs) continue;', replace: '' },
  { name: 'lista: antecedência ignorada ao listar', ts: `${L}slots.ts`, find: 's < nowMs + settings.minNoticeMinutes * MIN || s >= hz', replace: 's >= hz' },
  { name: 'lista: horizonte ignorado ao listar', ts: `${L}slots.ts`, find: 's < nowMs + settings.minNoticeMinutes * MIN || s >= hz', replace: 's < nowMs + settings.minNoticeMinutes * MIN' },
  { name: 'lista: intervalo anterior estoura a janela', ts: `${L}slots.ts`, find: 'if (s - svc.before * MIN < w.startMs) continue;', replace: '' },
  { name: 'lista: último horário que cabe é perdido', ts: `${L}slots.ts`, find: 'if (s + (svc.duration + svc.after) * MIN > w.endMs) break;', replace: 'if (s + (svc.duration + svc.after) * MIN >= w.endMs) break;' },
  { name: 'lista: serviço que passa do fim da janela', ts: `${L}slots.ts`, find: 'if (s + (svc.duration + svc.after) * MIN > w.endMs) break;', replace: 'if (s + svc.duration * MIN > w.endMs) break;' },
  { name: 'lista: passo ignorado', ts: `${L}slots.ts`, find: 'const s = w.startMs + k * settings.stepMinutes * MIN;', replace: 'const s = w.startMs + k * 5 * MIN;' },
  { name: 'lista: período sem teto de 62 dias', ts: `${L}slots.ts`, find: 'const end = to > addDays(from, 62) ? addDays(from, 62) : to;', replace: 'const end = to;' },
  { name: 'lista: conflito ignorado', ts: `${L}slots.ts`, find: 'if (busy.some((b) => overlaps(b, occ))) continue;', replace: '' },
  // ---------------------------------------------------------------- motor TS: estados e ações
  { name: 'status: concluído volta a ativo', ts: `${L}status.ts`, find: "if (from === 'confirmed') return to === 'cancelled' || to === 'completed' || to === 'no_show';", replace: "if (from === 'confirmed') return to === 'cancelled' || to === 'completed' || to === 'no_show' || to === 'scheduled';" },
  { name: 'status: agendado não pode ser cancelado', ts: `${L}status.ts`, find: "return to === 'confirmed' || to === 'cancelled' || to === 'completed' || to === 'no_show';", replace: "return to === 'confirmed' || to === 'completed' || to === 'no_show';" },
  { name: 'status: concluir antes do início permitido', ts: `${L}status.ts`, find: 'if (nowMs >= startsAtMs && (manager', replace: 'if (true && (manager' },
  { name: 'status: profissional conclui atendimento alheio', ts: `${L}status.ts`, find: "(profile === 'professional' && own)", replace: "(profile === 'professional')" },
  { name: 'status: profissional confirma', ts: `${L}status.ts`, find: "if (manager && status === 'scheduled') out.push('confirm');", replace: "if (status === 'scheduled') out.push('confirm');" },
  { name: 'status: profissional reagenda e cancela', ts: `${L}status.ts`, find: "if (manager) out.push('reschedule', 'cancel');", replace: "if (true) out.push('reschedule', 'cancel');" },
  { name: 'status: ações em atendimento encerrado', ts: `${L}status.ts`, find: 'if (!isActive(status)) return [];', replace: '' },
  { name: 'status: taxa sem dados vira 0%', ts: `${L}status.ts`, find: 'return d === 0 ? null :', replace: 'return d === 0 ? 0 :' },
  { name: 'status: taxa em escala errada', ts: `${L}status.ts`, find: 'Math.round((noShow * 1000) / d) / 10', replace: 'Math.round((noShow * 100) / d)' },
  { name: 'status: taxa ignora conclusões', ts: `${L}status.ts`, find: 'const d = completed + noShow;', replace: 'const d = noShow + noShow;' },
  // ---------------------------------------------------------------- motor TS: tempo e fuso
  { name: 'tempo: hora ambígua escolhe a primeira', ts: `${L}time.ts`, find: 'return Math.max(valid[0]!.inst, valid[1]!.inst);', replace: 'return Math.min(valid[0]!.inst, valid[1]!.inst);' },
  { name: 'tempo: hora inexistente recua', ts: `${L}time.ts`, find: 'return localUtc - before * MIN; // inexistente', replace: 'return localUtc - after * MIN; // inexistente' },
  { name: 'tempo: semana começa no domingo', ts: `${L}time.ts`, find: '((weekdayOf(date) + 6) % 7)', replace: '((weekdayOf(date) + 7) % 7)' },
  { name: 'tempo: intervalo de datas sem o último dia', ts: `${L}time.ts`, find: 'd <= to && i < 400', replace: 'd < to && i < 400' },
  { name: 'tempo: hora 24:30 aceita', ts: `${L}time.ts`, find: '/^([01]\\d|2[0-3]):[0-5]\\d$|^24:00$/', replace: '/^([01]\\d|2[0-4]):[0-5]\\d$|^24:00$/' },
  { name: 'tempo: data inexistente aceita (31/02)', ts: `${L}time.ts`, find: ' && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;', replace: ';' },
  { name: 'tempo: dia da semana errado', ts: `${L}time.ts`, find: "export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();", replace: "export const weekdayOf = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7;" },
  { name: 'tempo: deslocamento do fuso ignorado', ts: `${L}time.ts`, find: 'return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t) / MIN);', replace: 'return 0;' },
  // ---------------------------------------------------------------- E/S: CSV e token
  { name: 'exportação: «@» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=+\\-\\t\\r]/.test(s);' },
  { name: 'exportação: «=» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[+\\-@\\t\\r]/.test(s);' },
  { name: 'exportação: aspas não duplicadas', ts: `${L}csv.ts`, find: '"${safe.replace(/"/g, \'""\')}"', replace: '"${safe}"' },
  { name: 'exportação: separador no texto não protegido', ts: `${L}csv.ts`, find: '/[";\\n]/.test(safe)', replace: '/["\\n]/.test(safe)' },
  { name: 'exportação: quebra de linha mantida', ts: `${L}csv.ts`, find: "const s = v.replace(/\\r?\\n/g, ' ');", replace: 'const s = v;' },
  { name: 'token: segredo curto aceito', ts: `${L}token.ts`, find: 'if (s.length < 32) throw', replace: 'if (s.length < 1) throw' },
  { name: 'token: codificação diferente', ts: `${L}token.ts`, find: ".update(`ag-booking-v1:${idempotencyKey}`).digest('base64url')", replace: ".update(`ag-booking-v1:${idempotencyKey}`).digest('hex')" },
  { name: 'token: independe da chave de idempotência', ts: `${L}token.ts`, find: '.update(`ag-booking-v1:${idempotencyKey}`)', replace: '.update(`ag-booking-v1:`)' },
  { name: 'token: IP guardado sem hash', ts: `${L}token.ts`, find: ".update(`ag-client-v1:${ip}`).digest('hex').slice(0, 32);", replace: '.update(`ag-client-v1:${ip}`).digest(\'hex\').slice(0, 32) && ip;' },
  // ---------------------------------------------------------------- banco: motor de horários
  { name: 'banco/horário: passado aceito', file: 'ag_engine.sql', find: "if p_start <= now() then return 'past'; end if;", replace: "if false then return 'past'; end if;" },
  { name: 'banco/horário: antecedência mínima ignorada', file: 'ag_engine.sql', find: "if p_start < now() + make_interval(mins => st.minimum_notice_minutes) then return 'notice'; end if;", replace: "if false then return 'notice'; end if;" },
  { name: 'banco/horário: horizonte ignorado', file: 'ag_engine.sql', find: "if p_start >= hz then return 'horizon'; end if;", replace: "if false then return 'horizon'; end if;" },
  { name: 'banco/horário: profissional inativo aceito', file: 'ag_engine.sql', find: "if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org and active) then return 'professional'; end if;", replace: "if false then return 'professional'; end if;" },
  { name: 'banco/horário: serviço não vinculado aceito', file: 'ag_engine.sql', find: "then return 'association'; end if;", replace: 'then null; end if;' },
  { name: 'banco/horário: serviço desativado aceito', file: 'ag_engine.sql', find: 'if not found or (not sv.active and not p_existing) then return', replace: 'if not found then return' },
  { name: 'banco/horário: fora da janela aceito', file: 'ag_engine.sql', find: 'if w.w_start <= occ_s and occ_e <= w.w_end', replace: 'if w.w_start <= p_start and p_start < w.w_end' },
  { name: 'banco/horário: fim na janela recusado', file: 'ag_engine.sql', find: 'if w.w_start <= occ_s and occ_e <= w.w_end', replace: 'if w.w_start <= occ_s and occ_e < w.w_end' },
  { name: 'banco/horário: grade de inícios ignorada', file: 'ag_engine.sql', find: 'and (not p_public or mod(', replace: 'and (true or mod(' },
  { name: 'banco/horário: adjacência vira conflito', file: 'ag_engine.sql', find: "tstzrange(e.occupied_start_at, e.occupied_end_at, '[)') && tstzrange(occ_s, occ_e, '[)')", replace: "tstzrange(e.occupied_start_at, e.occupied_end_at, '[]') && tstzrange(occ_s, occ_e, '[]')" },
  { name: 'banco/horário: conflito ignorado', file: 'ag_engine.sql', find: "tstzrange(e.occupied_start_at, e.occupied_end_at, '[)') && tstzrange(occ_s, occ_e, '[)')) then", replace: "false) then" },
  { name: 'banco/horário: remarcação conflita consigo mesma', file: 'ag_engine.sql', find: '(p_ignore_entry is null or e.id <> p_ignore_entry)', replace: '(p_ignore_entry is null)', nth: 1 },
  { name: 'banco/horário: lista oferece o próprio horário ocupado', file: 'ag_engine.sql', find: '(p_ignore_entry is null or e.id <> p_ignore_entry)', replace: '(p_ignore_entry is null)', nth: 2 },
  { name: 'banco/horário: exceção não substitui o dia', file: 'ag_engine.sql', find: 'and not exists (select 1 from public.availability_overrides o where o.professional_id = p_prof and o.local_date = p_date);', replace: ';' },
  { name: 'banco/horário: regra desativada vale', file: 'ag_engine.sql', find: 'where r.professional_id = p_prof and r.active and r.weekday', replace: 'where r.professional_id = p_prof and r.weekday' },
  { name: 'banco/horário: lista sem teto de 62 dias', file: 'ag_engine.sql', find: 'if p_to - p_from > 62 then p_to := p_from + 62; end if;', replace: '' },
  { name: 'banco/horário: lista oferece horário passado', file: 'ag_engine.sql', find: 'continue when s <= now();', replace: '' },
  { name: 'banco/horário: lista sem antecedência', file: 'ag_engine.sql', find: 'continue when s < now() + make_interval(mins => st.minimum_notice_minutes);', replace: '' },
  { name: 'banco/horário: lista além do horizonte', file: 'ag_engine.sql', find: 'continue when s >= hz;', replace: '' },
  { name: 'banco/limite: teto de abuso inexistente', file: 'ag_engine.sql', find: 'if h > p_max then raise exception', replace: 'if h > p_max + 100000 then raise exception' },
  // ---------------------------------------------------------------- banco: reserva pública
  { name: 'banco/público: reserva sem consentimento', file: 'ag_public.sql', find: 'if not coalesce(p_consent, false) then raise', replace: 'if false then raise' },
  { name: 'banco/público: token fraco aceito', file: 'ag_public.sql', find: "if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,128}$' then raise exception 'solicitação inválida'", replace: "if false then raise exception 'solicitação inválida'" },
  { name: 'banco/público: chave reutilizada com outros dados', file: 'ag_public.sql', find: 'if req.request_hash <> rh then raise', replace: 'if false then raise' },
  { name: 'banco/público: limite por contato removido', file: 'ag_public.sql', find: "perform private.ag_rate_hit('book:contact:' ||", replace: "-- perform private.ag_rate_hit('book:contact:' ||" },
  { name: 'banco/público: limite por empresa removido', file: 'ag_public.sql', find: "perform private.ag_rate_hit('book:org:' || org::text, 120, 600);", replace: '' },
  { name: 'banco/público: serviço não público reservável', file: 'ag_public.sql', find: "and active and public_booking_enabled) then raise exception '%', private.ag_friendly('service')", replace: "and active) then raise exception '%', private.ag_friendly('service')" },
  { name: 'banco/público: nome sem tamanho mínimo', file: 'ag_public.sql', find: "nm := private.ag_req_text(p_name, 2, 120, 'Nome');", replace: "nm := private.ag_req_text(p_name, 0, 120, 'Nome');" },
  { name: 'banco/público: sem telefone nem e-mail aceito', file: 'ag_public.sql', find: 'if ph is null and em is null then raise', replace: 'if false then raise' },
  { name: 'banco/público: telefone inválido aceito', file: 'ag_public.sql', find: " or char_length(regexp_replace(ph, '\\D', '', 'g')) not between 8 and 15 then", replace: ' then' },
  { name: 'banco/público: e-mail inválido aceito', file: 'ag_public.sql', find: " or em !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' then", replace: ' then' },
  { name: 'banco/público: link expira nunca', file: 'ag_public.sql', find: 't.revoked_at is null and t.expires_at > now()', replace: 't.revoked_at is null' },
  { name: 'banco/público: link revogado vale', file: 'ag_public.sql', find: 't.revoked_at is null and t.expires_at > now()', replace: 't.expires_at > now()' },
  { name: 'banco/público: prazo de cancelamento ignorado', file: 'ag_public.sql', find: 'if now() > a.starts_at - make_interval(mins => st.customer_cancellation_notice_minutes) then', replace: 'if false then' },
  { name: 'banco/público: prazo de remarcação ignorado', file: 'ag_public.sql', find: 'if now() > a.starts_at - make_interval(mins => st.customer_rescheduling_notice_minutes) then', replace: 'if false then' },
  { name: 'banco/público: cancelar atendimento encerrado', file: 'ag_public.sql', find: "if a.status not in ('scheduled', 'confirmed') then raise exception 'esta reserva não pode mais ser cancelada pelo link'", replace: "if false then raise exception 'esta reserva não pode mais ser cancelada pelo link'" },
  { name: 'banco/público: remarcar atendimento encerrado', file: 'ag_public.sql', find: "if a.status not in ('scheduled', 'confirmed') then raise exception 'esta reserva não pode mais ser remarcada pelo link'", replace: "if false then raise exception 'esta reserva não pode mais ser remarcada pelo link'" },
  { name: 'banco/público: horários oferecidos a reserva encerrada', file: 'ag_public.sql', find: "if a.id is null or a.status not in ('scheduled', 'confirmed') then return null; end if;", replace: 'if a.id is null then return null; end if;' },
  { name: 'banco/público: serviço oculto aparece na página', file: 'ag_public.sql', find: 'where s.organization_id = org and s.active and s.public_booking_enabled', replace: 'where s.organization_id = org' },
  { name: 'banco/público: serviço oculto com horários', file: 'ag_public.sql', find: "if not exists (select 1 from public.services where id = p_svc and organization_id = org and active and public_booking_enabled) then\n    return jsonb_build_object", replace: "if false then\n    return jsonb_build_object" },
  { name: 'banco/público: página desativada acessível', file: 'ag_public.sql', find: 'where s.organization_id = org and s.active', replace: 'where s.organization_id = org and s.active or true' },
  // ---------------------------------------------------------------- banco: estados, permissões e isolamento
  { name: 'banco/estado: registrar antes do horário', file: 'ag_appointments.sql', find: "if target in ('completed', 'no_show') and now() < a.starts_at then raise", replace: 'if false then raise' },
  { name: 'banco/estado: repetir o mesmo estado', file: 'ag_appointments.sql', find: 'if a.status = target then raise', replace: 'if false then raise' },
  { name: 'banco/estado: transição inválida aceita', file: 'ag_appointments.sql', find: "if not ((a.status = 'scheduled' and target in ('confirmed', 'cancelled', 'completed', 'no_show')) or (a.status = 'confirmed' and target in ('cancelled', 'completed', 'no_show'))) then", replace: 'if false then' },
  { name: 'banco/estado: cancelar não libera o horário', file: 'ag_appointments.sql', find: 'update public.schedule_entries set active = false where id = a.schedule_entry_id;', replace: 'null;' },
  { name: 'banco/estado: motivo do cancelamento perdido', file: 'ag_appointments.sql', find: "cancellation_reason = case when target = 'cancelled' then private.ag_opt_text(p_reason, 300, 'Motivo') else cancellation_reason end", replace: 'cancellation_reason = cancellation_reason' },
  { name: 'banco/permissão: profissional conclui atendimento alheio', file: 'ag_appointments.sql', find: '    if prof is distinct from private.ag_my_professional(p_org) then', replace: '    if false then' },
  { name: 'banco/permissão: profissional edita notas alheias', file: 'ag_appointments.sql', find: "and prof is distinct from private.ag_my_professional(p_org) then raise exception 'atendimento não encontrado'", replace: "and false then raise exception 'atendimento não encontrado'" },
  { name: 'banco/permissão: sem verificação de papel ao mudar estado', file: 'ag_appointments.sql', find: "perform private.ag_guard(p_org, 'staff');", replace: 'null;', nth: 1 },
  { name: 'banco/permissão: sem 2º fator', file: 'ag_guards.sql', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária'", replace: "if false then raise exception 'verificação em duas etapas necessária'" },
  { name: 'banco/permissão: sem papel exigido', file: 'ag_guards.sql', find: "if not ok then raise exception 'sem permissão'", replace: "if false then raise exception 'sem permissão'" },
  { name: 'banco/permissão: gestor vale como proprietário', file: 'ag_guards.sql', find: "when 'owner' then private.ag_is_owner(p_org)", replace: "when 'owner' then private.ag_is_manager(p_org)" },
  { name: 'banco/perfil: membro sem vínculo vira profissional', file: 'ag_access.sql', find: "when 'member' then case when private.ag_my_professional(org) is not null then 'professional' end", replace: "when 'member' then 'professional'" },
  { name: 'banco/perfil: leitor tem acesso', file: 'ag_access.sql', find: "when 'manager' then 'manager'", replace: "when 'manager' then 'manager' when 'viewer' then 'manager'" },
  { name: 'banco/perfil: profissional vê todos os clientes', file: 'ag_access.sql', find: 'select private.ag_is_manager(org) or exists (\n    select 1 from public.appointments a where a.organization_id = org and a.customer_id = cust', replace: 'select true or exists (\n    select 1 from public.appointments a where a.organization_id = org and a.customer_id = cust' },
  // ---------------------------------------------------------------- concorrência e integridade
  { name: 'banco/integridade: sem exclusão de sobreposição', file: 'ag_schema.sql', find: "with &&\n  ) where (active)", replace: "with &&\n  ) where (false)", suite: 'conc' },
  { name: 'banco/integridade: sem exclusão de sobreposição (SQL)', file: 'ag_schema.sql', find: "with &&\n  ) where (active)", replace: "with &&\n  ) where (false)" },
  { name: 'concorrência: reserva sem trava por profissional', file: 'ag_appointments.sql', find: '  perform private.ag_lock(p_prof);', replace: '  null;', suite: 'conc' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };
const kindOf = (m) => m.suite ?? (m.ts ? 'unit' : 'db');

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const cmd = suite === 'unit'
      ? [join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/unit/engine-', 'tests/unit/token']
      : [join(dir, 'scripts', SCRIPT[suite])];
    const p = spawn(process.execPath, cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function applyMutation(path, mutate) {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const parts = text.split(mutate.find);
  const nth = mutate.nth ?? 1;
  if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
  if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
  if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
  writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
}

function workspace(label, mutate, suite) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-ag-mut-${label}-`));
  if (suite === 'unit') {
    for (const d of ['lib', 'tests', 'app', 'components']) cpSync(join(root, d), join(dir, d), { recursive: true });
    for (const f of ['vitest.config.ts', 'tsconfig.json', 'package.json']) cpSync(join(root, f), join(dir, f));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    if (mutate) applyMutation(join(dir, mutate.ts), mutate);
    return dir;
  }
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) applyMutation(join(dir, 'supabase', 'migrations', files.find((x) => x.includes(mutate.file))), mutate);
  return dir;
}

if (args.includes('--check')) {
  // só confere se cada mutação encontra o seu alvo (rápido; não roda suítes)
  let bad = 0;
  for (const m of M) {
    const path = m.ts ? join(root, m.ts) : join(migDir, files.find((x) => x.includes(m.file)) ?? '');
    const n = readFileSync(path, 'utf8').replaceAll('\r\n', '\n').split(m.find).length - 1;
    if (!(n >= 1 && (m.nth ? m.nth <= n : n === 1))) { bad++; console.log(`SEM ALVO ÚNICO (${n} ocorrências): ${m.name}`); }
  }
  console.log(bad ? `${bad} mutação(ões) com alvo inválido` : `${M.length} mutações com alvo válido`);
  process.exit(bad ? 1 : 0);
}

const todo = M.filter(wanted);
for (const suite of new Set(todo.map(kindOf))) {
  const base = workspace(`base-${suite}`, null, suite);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    const suite = kindOf(m);
    let dir;
    try {
      dir = workspace(String(next), m, suite);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, suite);
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
// a suíte de concorrência é sensível a carga: roda sozinha, depois das demais
const light = todo.filter((m) => kindOf(m) !== 'conc');
const heavy = todo.filter((m) => kindOf(m) === 'conc');
const all = todo.slice();
todo.length = 0;
todo.push(...light);
next = 0;
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
todo.length = 0;
todo.push(...heavy);
next = 0;
await Promise.all(Array.from({ length: 1 }, worker));
console.log(`\n${all.length - survived.length - broken.length}/${all.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
