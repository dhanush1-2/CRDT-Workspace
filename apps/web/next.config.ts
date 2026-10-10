import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// @crdt/db tries to load the repo-root .env itself, but webpack statically
// rewrites its `new URL(spec, import.meta.url)` call into an asset-module
// reference that resolves to a public asset path, not a filesystem path —
// so that load always fails when bundled here. Load it in this config file
// instead: Next runs next.config.ts directly as plain Node, never through
// webpack, so process.env.DATABASE_URL is already set by the time any
// route or component code runs. Production is unaffected — there is no
// .env file on Fly, and DATABASE_URL arrives via the host environment.
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'))
} catch {
  // .env is absent in CI/production; DATABASE_URL etc. come from the host.
}

const config: NextConfig = {
  transpilePackages: ['@crdt/shared', '@crdt/db'],
  // Turbopack cannot resolve @crdt/shared's NodeNext-style '.js' relative
  // imports, and does not support extensionAlias. The Node-side packages
  // genuinely need those extensions, so the workaround lives here rather
  // than in the shared package. Reconsider when Turbopack supports aliasing.
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  // The invite token is in the page's URL. A <meta name="referrer"> is parsed after the
  // stylesheet and script tags that precede it, so those requests would still carry the
  // token in Referer. A response header applies before anything is parsed. The page also
  // sets the metadata, as a second layer. no-store: no cache may keep a page whose content
  // depends on the token and the viewer.
  async headers() {
    return [
      {
        source: '/invite/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // A cancelled or failed sign-in that began on an invite link comes back here as
        // /login?error=...&next=/invite/<token>, so this URL can carry the token too, and
        // the page's sign-in links repeat it. Same two headers as the invite page: no
        // Referer, and no cache keeps it. no-store is harmless here: the page is dynamic
        // (it reads the session and the query) and is not worth caching anyway.
        source: '/login',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default config
