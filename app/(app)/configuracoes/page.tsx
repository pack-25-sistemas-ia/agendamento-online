import type { Metadata } from 'next';
import { AgForm, SelectF, TextF } from '@/components/ag/fields';
import { Card, PageHeader } from '@/components/ui/primitives';
import { saveRules } from '@/lib/scheduling/actions/settings';
import { pageCtx } from '@/lib/scheduling/page';

export const metadata: Metadata = { title: 'Configurações' };

const ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Cuiaba', 'America/Campo_Grande', 'America/Rio_Branco', 'America/Noronha', 'America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Bogota', 'America/Mexico_City', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'UTC'];

export default async function SettingsPage() {
  const c = await pageCtx(['owner']);
  const s = c.settings;
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];
  return (
    <>
      <PageHeader title="Configurações" description="Regras de agendamento da empresa. Valem para novas reservas; atendimentos já marcados não mudam." />
      <Card title="Regras de agendamento">
        <AgForm action={saveRules} submit="Salvar configurações" reset={false}>
          <>
              <SelectF name="timezone" label="Fuso horário da empresa" def={s.timezone} opts={zones.map((z) => ({ value: z, label: z }))} hint="Horários de atendimento e a página pública usam este fuso." span />
              <SelectF name="slot_step_minutes" label="Passo dos horários (min)" def={String(s.slot_step_minutes)} opts={[5, 10, 15, 20, 30, 60].map((n) => ({ value: String(n), label: `${n} min` }))} hint="De quanto em quanto tempo um horário é oferecido. Não altera a duração do serviço." />
              <TextF name="minimum_notice_minutes" label="Antecedência mínima (min)" def={String(s.minimum_notice_minutes)} type="number" inputMode="numeric" hint="Reservas públicas só até este tempo antes do horário." />
              <TextF name="booking_horizon_days" label="Horizonte de reservas (dias)" def={String(s.booking_horizon_days)} type="number" inputMode="numeric" hint="Até quantos dias à frente o cliente pode reservar." />
              <TextF name="customer_cancellation_notice_minutes" label="Prazo para o cliente cancelar (min antes)" def={String(s.customer_cancellation_notice_minutes)} type="number" inputMode="numeric" hint="1440 = 24 horas." />
              <TextF name="customer_rescheduling_notice_minutes" label="Prazo para o cliente reagendar (min antes)" def={String(s.customer_rescheduling_notice_minutes)} type="number" inputMode="numeric" />
            </>
        </AgForm>
      </Card>
      <p className="mt-4 text-xs text-muted">Trocar o fuso muda a hora local em que as janelas semanais acontecem; reservas já feitas continuam no mesmo instante. Revise a disponibilidade depois de trocar.</p>
    </>
  );
}
