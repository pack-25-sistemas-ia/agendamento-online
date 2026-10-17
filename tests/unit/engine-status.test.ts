// Estados do atendimento, ações permitidas, taxa de não comparecimento e CSV seguro.
import { describe, expect, it } from 'vitest';
import { STATUSES, availableActions, canTransition, isActive, noShowRate, type Status } from '@/lib/scheduling/status';
import { csvText, toCsv } from '@/lib/scheduling/csv';

describe('transições de status (mesma tabela do trigger do banco)', () => {
  it('fluxos válidos', () => {
    expect(canTransition('scheduled', 'confirmed')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    for (const from of ['scheduled', 'confirmed'] as const) {
      expect(canTransition(from, 'completed')).toBe(true);
      expect(canTransition(from, 'no_show')).toBe(true);
    }
  });
  it('tudo o mais é inválido: estados finais não mudam; não volta para «agendado»', () => {
    const valid = new Set(['scheduled>confirmed', 'scheduled>cancelled', 'scheduled>completed', 'scheduled>no_show', 'confirmed>cancelled', 'confirmed>completed', 'confirmed>no_show']);
    for (const a of STATUSES) for (const b of STATUSES) expect(canTransition(a as Status, b as Status), `${a}→${b}`).toBe(valid.has(`${a}>${b}`));
    expect(isActive('scheduled') && isActive('confirmed')).toBe(true);
    expect(isActive('completed') || isActive('no_show') || isActive('cancelled')).toBe(false);
  });
});

describe('ações disponíveis por perfil e horário', () => {
  const NOW = 1_000_000;
  const act = (status: Status, startsAtMs: number, profile: 'owner' | 'manager' | 'professional', own = true) => availableActions({ status, startsAtMs, nowMs: NOW, profile, own });
  it('gestor: confirmar só se agendado; remarcar e cancelar enquanto ativo; concluir só depois do início', () => {
    expect(act('scheduled', NOW + 1, 'manager')).toEqual(['confirm', 'reschedule', 'cancel']);
    expect(act('confirmed', NOW + 1, 'manager')).toEqual(['reschedule', 'cancel']);
    expect(act('scheduled', NOW, 'manager')).toEqual(['confirm', 'complete', 'no_show', 'reschedule', 'cancel']); // começou exatamente agora
    expect(act('confirmed', NOW - 1, 'owner')).toEqual(['complete', 'no_show', 'reschedule', 'cancel']);
  });
  it('profissional: só concluir/não compareceu, nos próprios atendimentos, depois do início', () => {
    expect(act('scheduled', NOW - 1, 'professional')).toEqual(['complete', 'no_show']);
    expect(act('scheduled', NOW + 1, 'professional')).toEqual([]);
    expect(act('scheduled', NOW - 1, 'professional', false)).toEqual([]);
  });
  it('estados finais não têm ações', () => {
    for (const s of ['completed', 'no_show', 'cancelled'] as const) expect(act(s, NOW - 1, 'owner')).toEqual([]);
  });
});

describe('taxa de não comparecimento', () => {
  it('no_show / (completed + no_show); denominador zero = sem dado (nunca 0%)', () => {
    expect(noShowRate(3, 1)).toBe(25);
    expect(noShowRate(0, 4)).toBe(100);
    expect(noShowRate(5, 0)).toBe(0);
    expect(noShowRate(0, 0)).toBeNull();
    expect(noShowRate(2, 1)).toBe(33.3);
  });
});

describe('CSV seguro', () => {
  it('células que parecem fórmula são neutralizadas (= + - @ tab CR)', () => {
    for (const s of ['=2+2', '+1', '-1', '@SOMA(A1)', '\tcmd', '\rcmd']) expect(csvText(s).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    expect(csvText('Maria')).toBe('Maria');
    expect(csvText('a-b')).toBe('a-b');
  });
  it('aspas, separador e quebra de linha são escapados', () => {
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvText('linha1\nlinha2')).toBe('linha1 linha2');
  });
  it('documento: BOM, separador «;», CRLF e vazios', () => {
    const out = toCsv([{ key: 'n', label: 'Nome', kind: 'text' }, { key: 'q', label: 'Qtd', kind: 'int' }], [{ n: '=HYPERLINK("x")', q: 3.9 }, { n: 'Ana', q: null }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    const lines = out.slice(1).split('\r\n');
    expect(lines[0]).toBe('Nome;Qtd');
    expect(lines[1]).toBe("\"'=HYPERLINK(\"\"x\"\")\";3");
    expect(lines[2]).toBe('Ana;');
    expect(out.endsWith('\r\n')).toBe(true);
  });
});
