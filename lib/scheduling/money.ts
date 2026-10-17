// Preço de referência em centavos inteiros (o sistema não controla pagamentos: é só informativo).
/** «80», «80,50», «1.234,50» → centavos; vazio → null. */
export function priceToCents(raw: string | undefined): number | null | 'invalid' {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return 'invalid';
  const [int, dec = ''] = s.replace(/\./g, '').split(',');
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : 'invalid';
}

