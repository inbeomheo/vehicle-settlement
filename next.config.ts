import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['pg', 'bcryptjs', 'pdfkit'],
  outputFileTracingIncludes: {
    '/api/uses/**': ['./assets/fonts/**/*', './node_modules/pdfkit/js/**/*'],
    '/api/statements/**': ['./assets/fonts/**/*', './node_modules/pdfkit/js/**/*'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
