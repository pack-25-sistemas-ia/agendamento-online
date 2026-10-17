import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicBooking, type PublicService } from '@/components/ag/public-booking';
import { publicClient } from '@/lib/scheduling/public-db';
import { instantToLocal } from '@/lib/scheduling/time';
import { nowMs } from '@/lib/time';
import { themeParam } from '@/lib/theme';
import { safePrimary } from '@/lib/utils';

type Dto = {
  name: string; description: string | null; contact: string | null; policy: string | null; timezone: string; color: string; has_logo: boolean; horizon_days: number;
  cancel_notice_minutes: number; reschedule_notice_minutes: number; services: PublicService[];
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
async function load(slug: string): Promise<Dto | null> {
  if (!SLUG.test(slug.toLowerCase()) || slug.length > 60) return null;
  const { data } = await publicClient().rpc('ag_public_page', { p_slug: slug });
  return (data as Dto | null) ?? null;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  return d ? { title: `Agende seu horário · ${d.name}`, description: d.description ?? undefined } : { title: 'Página de reservas' };
}

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const today = instantToLocal(nowMs(), d.timezone).date;
  const notice = (m: number) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} dia(s)` : m >= 60 && m % 60 === 0 ? `${m / 60} hora(s)` : `${m} minuto(s)`);
  return (
    <>
      <link rel="stylesheet" href={`/theme.css?c=${themeParam(safePrimary(d.color))}`} precedence="theme" />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <header className="mb-6 flex items-center gap-4">
          {d.has_logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/image injeta style inline, bloqueado pela CSP estrita; o arquivo é servido pela própria rota
            <img src={`/agendar/${slug.toLowerCase()}/logo`} alt={`Logotipo de ${d.name}`} width={64} height={64} className="size-16 shrink-0 rounded-lg border border-border object-contain" />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight">{d.name}</h1>
            {d.description ? <p className="mt-1 text-sm text-muted">{d.description}</p> : null}
          </div>
        </header>
        <PublicBooking page={{ slug: slug.toLowerCase(), name: d.name, timezone: d.timezone, today, horizonDays: d.horizon_days, policy: d.policy, contact: d.contact, services: d.services }} />
        <footer className="mt-10 space-y-2 border-t border-border pt-4 text-xs text-muted">
          {d.contact ? <p><strong>Contato:</strong> {d.contact}</p> : null}
          <p><strong>Fuso horário:</strong> {d.timezone}. Cancelamento e remarcação pelo link até {notice(d.cancel_notice_minutes)} antes do horário.</p>
          {d.policy ? <p><strong>Política:</strong> {d.policy}</p> : null}
          <p>Você receberá um link para consultar, cancelar ou reagendar a reserva. Guarde-o: sem ele, fale com a empresa.</p>
        </footer>
      </main>
    </>
  );
}
