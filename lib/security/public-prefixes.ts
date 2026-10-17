// Prefixos de rota acessíveis SEM sessão, além das rotas de autenticação (ver paths.ts).
// Este sistema expõe a página pública de reservas e o link de gerenciamento da reserva.
// Cada rota pública faz a própria validação (slug ativo, token de 256 bits, limite de abuso) e nunca usa a sessão do usuário.
// Arquivo do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
export const PUBLIC_PREFIXES: readonly string[] = ['/agendar/', '/reserva/'];
