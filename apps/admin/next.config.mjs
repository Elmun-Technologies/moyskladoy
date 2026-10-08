const api = process.env.API_INTERNAL_URL ?? 'https://moyskladoy.fly.dev';
/** /api/* -> Fastify API (same-origin: cookie'lar CORS'siz ishlaydi). */
const config = {
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: api + '/api/:path*' }];
  },
};
export default config;
