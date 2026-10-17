import 'server-only';
import { createHmac } from 'node:crypto';

// Link de gerenciamento da reserva. O token é derivado (HMAC-SHA256, 256 bits) da chave de idempotência com um segredo SÓ do servidor:
//  · um reenvio do mesmo formulário devolve exatamente o mesmo link (idempotência real, sem guardar o texto do token);
//  · quem só vê a chave de idempotência (que passa pelo navegador) não consegue calcular o token;
//  · o banco guarda apenas o hash (sha256) do token — quem lê o banco não consegue usar o link.
// Sem BOOKING_TOKEN_SECRET (mín. 32 caracteres) a reserva pública NÃO funciona (falha fechada).
export function bookingTokenSecret(): string {
  const s = process.env.BOOKING_TOKEN_SECRET ?? '';
  if (s.length < 32) throw new Error('BOOKING_TOKEN_SECRET ausente ou curto demais (mínimo de 32 caracteres)');
  return s;
}

export function deriveBookingToken(idempotencyKey: string): string {
  return createHmac('sha256', bookingTokenSecret()).update(`ag-booking-v1:${idempotencyKey}`).digest('base64url');
}

/** Identificador anônimo do cliente para limite de abuso (nunca o IP puro). */
export function clientKey(ip: string): string {
  return createHmac('sha256', bookingTokenSecret()).update(`ag-client-v1:${ip}`).digest('hex').slice(0, 32);
}
