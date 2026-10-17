import type { Metadata } from 'next';
import { AgForm, AreaF, CheckF, TextF } from '@/components/ag/fields';
import { CopyField } from '@/components/ag/copy-field';
import { LogoForm } from '@/components/ag/logo-form';
import { Card, PageHeader } from '@/components/ui/primitives';
import { savePublicPage } from '@/lib/scheduling/actions/settings';
import { pageCtx } from '@/lib/scheduling/page';
import { PALETTE } from '@/lib/scheduling/palette';

export const metadata: Metadata = { title: 'Página de reservas' };

export default async function PublicPageSettings() {
  const c = await pageCtx(['owner']);
  const { data: org } = await c.ctx.supabase.from('organizations').select('slug').eq('id', c.org).maybeSingle();
  const slug = (org as { slug: string } | null)?.slug ?? '';
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const link = `${base}/agendar/${slug}`;
  const s = c.settings;
  return (
    <>
      <PageHeader title="Página de reservas" description="A página pública onde seus clientes escolhem serviço, profissional, data e horário. Não é preciso conta para reservar." />
      <Card title="Link para divulgar" description={s.public_booking_enabled ? 'A página está ATIVA.' : 'A página está DESATIVADA: ninguém consegue reservar até você ativá-la abaixo.'}>
        <CopyField label="Endereço da página" value={link} />
        <p className="mt-2 text-xs text-muted">Use este link no Instagram, WhatsApp e Google. O endereço identifica só a página de reservas; ele não dá acesso ao painel.</p>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Identidade e textos">
          <AgForm action={savePublicPage} submit="Salvar página" reset={false} className="grid gap-4">
            <>
                <CheckF name="public_booking_enabled" label="Página ativa (aceita reservas)" def={s.public_booking_enabled} />
                <TextF name="public_display_name" label="Nome exibido" def={s.public_display_name} max={80} hint="Se vazio, usa o nome da empresa." />
                <AreaF name="public_description" label="Descrição curta" def={s.public_description} max={500} />
                <TextF name="public_contact" label="Contato (telefone, WhatsApp, e-mail)" def={s.public_contact} max={200} />
                <label className="flex flex-col gap-1 text-sm font-medium">Cor principal
                  <input type="color" name="primary_color" defaultValue={s.primary_color} list="paleta" className="h-10 w-24 rounded-md border border-border bg-card p-1" />
                  <datalist id="paleta">{PALETTE.map((p) => <option key={p.hex} value={p.hex}>{p.name}</option>)}</datalist>
                </label>
                <AreaF name="booking_policy_text" label="Política de cancelamento e remarcação" def={s.booking_policy_text} max={1000} hint="Aparece antes da confirmação. Os prazos automáticos ficam em Configurações." />
              </>
          </AgForm>
        </Card>
        <Card title="Logotipo" description="PNG, JPG ou WebP de até 512 KB. SVG não é aceito (pode carregar scripts).">
          <LogoForm hasLogo={!!s.logo_path} />
        </Card>
      </div>
    </>
  );
}
