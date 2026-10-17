// Estados do atendimento e ações permitidas. O banco repete as mesmas regras (trigger de transição + função ag_set_status); aqui só decidimos o que mostrar.
export const STATUSES = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export type Profile = 'owner' | 'manager' | 'professional';
export type Action = 'confirm' | 'cancel' | 'complete' | 'no_show' | 'reschedule';

export const STATUS_LABEL: Record<Status, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído', no_show: 'Não compareceu', cancelled: 'Cancelado' };
export const STATUS_TONE: Record<Status, 'neutral' | 'success' | 'warning' | 'danger'> = { scheduled: 'warning', confirmed: 'success', completed: 'neutral', no_show: 'danger', cancelled: 'neutral' };
export const ACTION_LABEL: Record<Action, string> = { confirm: 'Confirmar', cancel: 'Cancelar atendimento', complete: 'Marcar como concluído', no_show: 'Registrar não comparecimento', reschedule: 'Reagendar' };
export const SOURCE_LABEL: Record<string, string> = { admin: 'Equipe', public: 'Página pública' };
export const EVENT_LABEL: Record<string, string> = {
  created: 'Reserva criada', confirmed: 'Confirmado', rescheduled: 'Reagendado', cancelled: 'Cancelado', completed: 'Concluído', no_show: 'Não compareceu',
  notes_updated: 'Notas internas atualizadas', link_reissued: 'Novo link de gerenciamento emitido', customer_anonymized: 'Dados do cliente anonimizados',
};
export const ACTOR_LABEL: Record<string, string> = { admin: 'Equipe', professional: 'Profissional', customer: 'Cliente', system: 'Sistema' };
export const PROFILE_LABEL: Record<Profile, string> = { owner: 'Proprietário', manager: 'Gestor/recepção', professional: 'Profissional' };

export const isActive = (s: Status): boolean => s === 'scheduled' || s === 'confirmed';
export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

/** Transições válidas (idênticas às do trigger ag_appointment_guard). */
export function canTransition(from: Status, to: Status): boolean {
  if (from === 'scheduled') return to === 'confirmed' || to === 'cancelled' || to === 'completed' || to === 'no_show';
  if (from === 'confirmed') return to === 'cancelled' || to === 'completed' || to === 'no_show';
  return false;
}

/** Ações que o usuário pode ver. Concluir/não comparecimento só depois do início; profissional só nos próprios atendimentos e só essas duas. */
export function availableActions(p: { status: Status; startsAtMs: number; nowMs: number; profile: Profile; own: boolean }): Action[] {
  const { status, startsAtMs, nowMs, profile, own } = p;
  if (!isActive(status)) return [];
  const out: Action[] = [];
  const manager = profile === 'owner' || profile === 'manager';
  if (manager && status === 'scheduled') out.push('confirm');
  if (nowMs >= startsAtMs && (manager || (profile === 'professional' && own))) out.push('complete', 'no_show');
  if (manager) out.push('reschedule', 'cancel');
  return out;
}

/** Taxa de não comparecimento = no_show / (completed + no_show). Denominador zero → null («Sem dados»), nunca 0%. */
export function noShowRate(completed: number, noShow: number): number | null {
  const d = completed + noShow;
  return d === 0 ? null : Math.round((noShow * 1000) / d) / 10;
}
