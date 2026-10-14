import type { Metadata } from 'next';

/**
 * Root layout. Required by the App Router even though every real page is a
 * tenant under `_sites/[domain]`.
 *
 * Tenant-specific <html> attributes (lang, per-site meta) are set by the tenant
 * layout via hoisted tags rather than here, because this layout cannot know
 * which tenant is rendering.
 */
export const metadata: Metadata = {
  title: 'anagata-web-engine',
  description: 'Multi-tenant website and blog engine.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: 'var(--bg-canvas, #ffffff)',
          color: 'var(--text-primary, #111111)',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {children}
      </body>
    </html>
  );
}