import { NextResponse } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { publicClient } from '@/lib/scheduling/public-db';

// Serve o logotipo da página pública a partir do Storage, pelo próprio domínio (a CSP só permite imagens do próprio site e o caminho,
// que contém o id da empresa, nunca chega ao navegador). Somente imagens raster conferidas no envio.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!SLUG.test(slug) || slug.length > 60) return new NextResponse(null, { status: 404 });
  const { data: path } = await publicClient().rpc('ag_public_logo_path', { p_slug: slug });
  if (typeof path !== 'string' || !/^[0-9a-f-]{36}\/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$/.test(path)) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ag-logos/${path}`, { cache: 'no-store' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!res.ok || !ALLOWED.has(type)) return new NextResponse(null, { status: 404 });
  return new NextResponse(res.body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
  });
}
