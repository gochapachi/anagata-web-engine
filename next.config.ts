import type { NextConfig } from 'next';

/**
 * Multi-tenant engine config.
 *
 * output: 'standalone' keeps the production container ~90MB and lets Coolify
 * run `node server.js` directly instead of a full `next start` toolchain.
 *
 * The `/sites/[domain]` branch is never reachable directly from a browser
  * because middleware rewrites every public request into it.
  *
  * WHY NOT `_sites`: an App Router folder whose name starts with `_` is a PRIVATE
  * route segment - Next.js excludes it from routing entirely, and a middleware
  * rewrite cannot reach it either. `src/app/_sites/[domain]` produced no route at
  * all (the build listed only /, /_not-found, /api/* and /robots.txt), so every
  * tenant page 404'd no matter what the database held. The folder is `sites/`.
  */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  /**
   * Tailwind v4's compiler and MDX are used at REQUEST time (see
   * `src/lib/compile.ts` and the MDX renderer), so they must stay OUT of the
   * webpack bundle: `@tailwindcss/oxide` is a native `.node` binary, and
   * bundling it fails with "Module parse failed: Unexpected character".
   * Marking them external keeps them as ordinary runtime requires.
   */
  serverExternalPackages: [
    'tailwindcss',
    '@tailwindcss/postcss',
    '@tailwindcss/node',
    '@tailwindcss/oxide',
    '@mdx-js/mdx',
    'postcss',
  ],
  images: {
    // Tenants serve images through the first-party /media proxy, so remote
    // patterns stay locked down to the engine's own hostnames.
    remotePatterns: [
      { protocol: 'https', hostname: '**.anagataitsolutions.in' },
      { protocol: 'http', hostname: '213.199.62.248' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;