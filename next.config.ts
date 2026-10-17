import type { NextConfig } from 'next';

// Cabeçalhos estáticos. A CSP com nonce é gerada por requisição em proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

// Link de gerenciamento da reserva: o token está na URL, então a página NUNCA envia Referer a terceiros, não é indexada nem fica em cache compartilhado.
const bookingLinkHeaders = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'private, no-store' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/reserva/:path*', headers: bookingLinkHeaders },
    ];
  },
};

export default nextConfig;
