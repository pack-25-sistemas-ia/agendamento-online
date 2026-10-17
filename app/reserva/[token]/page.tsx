import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CancelBooking, RescheduleBooking } from '@/components/ag/manage-booking';
import { PrintButton } from '@/components/ag/print-button';
import { publicClient } from '@/lib/scheduling/public-db';
import { STATUS_LABEL, type Status } from '@/lib/scheduling/status';
import { formatDateLong, formatInstant, instantToLocal } from '@/lib/scheduling/time';
import { nowMs } from '@/lib/time';
import { themeParam } from '@/lib/theme';
import { safePrimary } from '@/lib/utils';

// Página do cliente: consultar, cancelar e reagendar a PRÓPRIA reserva pelo link secreto. Sem login, sem navegação para outras reservas.
// Cabeçalhos (next.config.ts): Referrer-Policy no-referrer, noindex, no-store. Nenhum script de terceiros nesta página.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sua reserva', robots: { index: false, follow: false } };

type Dto = {
  status: Status; starts_at: string; ends_at: string; service: string; duration_minutes: number; price_cents: number | null; professional: string; business: string; contact: string | null;
  policy: string | null; timezone: string; color: string; can_cancel: boolean; cancel_deadline: string; can_reschedule: boolean; reschedule_deadline: string;
};
const brl = (c: number | null) => (c === null ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100));

export default async function BookingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) notFound();
  const { data } = await publicClient().rpc('ag_public_get_booking', { p_token: token });
  const d = data as Dto | null;
  if (!d) notFound(); // inválido, expirado ou revogado: a resposta é sempre a mesma
  const start = instantToLocal(Date.parse(d.starts_at), d.timezone);
  const active = d.status === 'scheduled' || d.status === 'confirmed';
  const today = instantToLocal(nowMs(), d.timezone).date;
  const banner = sp.nova ? 'Reserva confirmada! Guarde esta página: ela é o seu comprovante e o link para cancelar ou reagendar.' : sp.reagendada ? 'Reserva reagendada com sucesso.' : sp.cancelada ? 'Reserva cancelada. O horário foi liberado.' : null;
  return (
    <>
      <link rel="stylesheet" href={`/theme.css?c=${themeParam(safePrimary(d.color))}`} precedence="theme" />
      <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <p className="text-sm text-muted">{d.business}</p>
        <h1 className="mb-4 text-2xl font-semibold">Sua reserva</h1>
        {banner ? <p role="status" className="mb-4 rounded-lg border border-success p-3 text-sm">{banner}</p> : null}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="resumo">
          <h2 id="resumo" className="sr-only">Resumo da reserva</h2>
          <p><span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">{STATUS_LABEL[d.status] ?? d.status}</span></p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Serviço</dt><dd className="font-medium">{d.service} · {d.duration_minutes} min</dd></div>
            <div><dt className="text-xs text-muted">Profissional</dt><dd className="font-medium">{d.professional}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Data e horário</dt><dd className="font-medium capitalize">{formatDateLong(start.date)} às {start.time}</dd></div>
            <div><dt className="text-xs text-muted">Fuso horário</dt><dd>{d.timezone}</dd></div>
            {brl(d.price_cents) ? <div><dt className="text-xs text-muted">Valor de referência</dt><dd>{brl(d.price_cents)} (pago no atendimento)</dd></div> : null}
          </dl>
          {d.contact ? <p className="text-sm"><span className="text-xs text-muted">Contato da empresa:</span> {d.contact}</p> : null}
          {d.policy ? <p className="rounded-md bg-black/5 p-3 text-xs dark:bg-white/5"><strong>Política:</strong> {d.policy}</p> : null}
        </section>

        {active ? (
          <section className="mt-5 space-y-4" aria-labelledby="acoes">
            <h2 id="acoes" className="text-base font-semibold">O que você pode fazer</h2>
            {d.can_reschedule ? <RescheduleBooking token={token} today={today} horizonDays={30} timezone={d.timezone} /> : <p className="text-sm text-muted">O prazo para reagendar pelo link terminou em {formatInstant(Date.parse(d.reschedule_deadline), d.timezone)}. Fale com a empresa.</p>}
            {d.can_cancel ? <CancelBooking token={token} /> : <p className="text-sm text-muted">O prazo para cancelar pelo link terminou em {formatInstant(Date.parse(d.cancel_deadline), d.timezone)}. Fale com a empresa.</p>}
          </section>
        ) : <p className="mt-5 text-sm text-muted">Esta reserva não pode mais ser alterada pelo link.</p>}

        <div className="mt-6 print:hidden"><PrintButton /></div>
      </main>
    </>
  );
}
