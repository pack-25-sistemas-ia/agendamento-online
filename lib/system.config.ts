// Configuração do Agendamento Online. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `groups`.
// (A marca da PÁGINA PÚBLICA — nome, logotipo, cor, textos — é configurada dentro do sistema, em «Página de reservas».)
// Perfis (ver docs/PERMISSIONS.md): owner = proprietário · manager = gestor/recepção · professional = profissional vinculado.
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { Profile } from '@/lib/scheduling/status';

export type NavItem = { href: string; label: string; profiles?: readonly Profile[] };
export type NavGroup = { title: string; items: NavItem[] };

const ALL: readonly Profile[] = ['owner', 'manager', 'professional'];
const MGMT: readonly Profile[] = ['owner', 'manager'];

export const systemConfig: { name: string; logo: string; groups: NavGroup[] } = {
  name: 'Agendamento Online',
  logo: '/brand/logo.svg',
  groups: [
    {
      title: 'Operação',
      items: [
        { href: '/dashboard', label: 'Visão geral', profiles: ALL },
        { href: '/agenda', label: 'Agenda', profiles: ALL },
        { href: '/agendamentos', label: 'Agendamentos', profiles: ALL },
        { href: '/clientes', label: 'Clientes', profiles: MGMT },
      ],
    },
    {
      title: 'Cadastros',
      items: [
        { href: '/profissionais', label: 'Profissionais', profiles: MGMT },
        { href: '/servicos', label: 'Serviços', profiles: MGMT },
        { href: '/disponibilidade', label: 'Disponibilidade', profiles: MGMT },
      ],
    },
    {
      title: 'Empresa',
      items: [
        { href: '/pagina-de-reservas', label: 'Página de reservas', profiles: ['owner'] },
        { href: '/configuracoes', label: 'Configurações', profiles: ['owner'] },
      ],
    },
  ],
};
