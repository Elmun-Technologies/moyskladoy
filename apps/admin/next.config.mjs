const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
/** /api/* -> Fastify API (same-origin: cookie'lar CORS'siz ishlaydi). */
const config = {
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: api + '/api/:path*' }];
  },
};
export default config;
