import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientKey, deriveBookingToken } from '@/lib/scheduling/token';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-ok';
const original = process.env.BOOKING_TOKEN_SECRET;
beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = SECRET; });
afterEach(() => { if (original === undefined) delete process.env.BOOKING_TOKEN_SECRET; else process.env.BOOKING_TOKEN_SECRET = original; });

describe('token do link de gerenciamento', () => {
  it('é determinístico para a mesma chave de idempotência (reenvio devolve o mesmo link)', () => {
    const k = '3f0e8a3e-8d41-4a39-9c1c-0a7f2c1d9b11';
    expect(deriveBookingToken(k)).toBe(deriveBookingToken(k));
  });
  it('muda com a chave e com o segredo', () => {
    const a = deriveBookingToken('a');
    expect(deriveBookingToken('b')).not.toBe(a);
    process.env.BOOKING_TOKEN_SECRET = `${SECRET}-outro`;
    expect(deriveBookingToken('a')).not.toBe(a);
  });
  it('tem 256 bits em base64url e atende ao formato aceito pelo banco (40–128 caracteres)', () => {
    const t = deriveBookingToken('x');
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('falha fechada sem segredo ou com segredo curto', () => {
    delete process.env.BOOKING_TOKEN_SECRET;
    expect(() => deriveBookingToken('x')).toThrow(/BOOKING_TOKEN_SECRET/);
    process.env.BOOKING_TOKEN_SECRET = 'curto';
    expect(() => deriveBookingToken('x')).toThrow(/BOOKING_TOKEN_SECRET/);
    expect(() => clientKey('1.2.3.4')).toThrow();
  });
  it('clientKey não expõe o IP e é estável', () => {
    const k = clientKey('203.0.113.9');
    expect(k).not.toContain('203');
    expect(k).toBe(clientKey('203.0.113.9'));
    expect(k).not.toBe(clientKey('203.0.113.10'));
  });
});
