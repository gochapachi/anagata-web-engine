import { MobileNavToggle } from './MobileNav';
import type { ShellProps } from './types';

/**
 * Structural shells. Each wraps the SAME children in a DIFFERENT document
 * skeleton: different header placement, different main grid, different footer.
 *
 * These are intentionally thin - colour/type come from genome tokens, and the
 * page content comes from the AI-authored sections. What differs here is the
 * scaffolding users perceive as "this is a different website".
 */

function Footer({ props }: { props: ShellProps }) {
  const { brandName, footer } = props;
  return (
    <footer className="shell-footer">
      <div className="shell-container" style={{ display: 'grid', gap: '2rem' }}>
        <strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem' }}>{brandName}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1.5rem' }}>
          {footer.map((column) => (
            <div key={column.title}>
              <div className="shell-eyebrow" style={{ color: 'inherit', opacity: 0.7 }}>
                {column.title}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0', display: 'grid', gap: '0.4rem' }}>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.href}-${link.label}`}>
                    <a href={link.href} style={{ color: 'inherit', textDecoration: 'none', opacity: 0.85 }}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}

export function EditorialMagazineShell(props: ShellProps) {
  const { children, brandName, nav, cta, phone, genome } = props;
  return (
    <div>
      <header className="shell-header" style={{ background: 'var(--bg-canvas)' }}>
        <Masthead brandName={brandName} nav={nav} cta={cta} phone={phone} />
      </header>
      {/* Editorial: hairline vertical rules frame the column grid. */}
      <main
        className="shell-main"
        style={{
          borderTop: '1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)',
        }}
      >
        {children}
      </main>
      <Footer props={props} />
      <span hidden>{genome.shell_archetype}</span>
    </div>
  );
}

function Masthead({
  brandName,
  nav,
  cta,
  phone,
}: {
  brandName: string;
  nav: ShellProps['nav'];
  cta: ShellProps['cta'];
  phone?: string;
}) {
  // The raw phone string is NOT rendered here. It appeared as unstyled loose
  // text directly under the header on both audited sites; phone numbers are
  // styled links or the CTA's job, so this masthead renders a tel: link.
  const phoneHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;

  return (
    <div className="shell-container">
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          paddingBlock: '0.6rem',
          fontSize: '0.78rem',
          borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        }}
      >
        {phoneHref ? (
          <a className="shell-eyebrow" href={phoneHref} style={{ color: 'inherit', textDecoration: 'none' }}>
            {phone}
          </a>
        ) : (
          <span className="shell-eyebrow">{cta?.label ?? ''}</span>
        )}
        <span className="shell-eyebrow">{phoneHref ? (cta?.label ?? 'Book a consultation') : ''}</span>
      </div>
      <div style={{ textAlign: 'center', paddingBlock: '1.5rem' }}>
        <a
          href="/"
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          {brandName}
        </a>
      </div>
      <nav aria-label="Primary">
        <ul
          className="shell-nav-links"
          style={{ justifyContent: 'center', borderTop: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)', paddingBlock: '0.7rem' }}
        >
          {nav.map((item) => (
            <li key={`${item.href}-${item.label}`}>
              <a href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {/* Mobile only: the links above are hidden below 768px, so without this
          there is no navigation at all on a phone. */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '.5rem' }}>
        <MobileNavToggle nav={nav} cta={cta} />
      </div>
    </div>
  );
}

export function SwissBrutalistShell(props: ShellProps) {
  const { children, brandName, nav, cta, phone, genome } = props;
  const phoneHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;
  return (
    // Two-column document: persistent rail + content. On mobile the rail
    // becomes a top bar (see shell.css).
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,280px) minmax(0,1fr)' }} className="shell-rail-grid">
      <aside className="shell-rail">
        <a
          href="/"
          style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', fontWeight: 700, color: 'inherit', textDecoration: 'none' }}
        >
          {brandName}
        </a>
        <nav aria-label="Primary">
          <ul className="shell-nav-links" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
            {nav.map((item) => (
              <li key={`${item.href}-${item.label}`}>
                <a href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MobileNavToggle nav={nav} cta={cta} />
        </div>
        {cta ? (
          <a className="shell-btn" href={cta.href} style={{ justifyContent: 'center' }}>
            {cta.label}
          </a>
        ) : null}
        {phoneHref ? (
          <a className="shell-eyebrow" href={phoneHref} style={{ marginTop: 'auto', color: 'inherit', textDecoration: 'none' }}>
            {phone}
          </a>
        ) : null}
      </aside>
      <div>
        <main className="shell-main">{children}</main>
        <Footer props={props} />
      </div>
      <span hidden>{genome.shell_archetype}</span>
    </div>
  );
}

export function ClinicalGlassShell(props: ShellProps) {
  const { children, brandName, nav, cta, phone, genome } = props;
  const phoneHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;
  return (
    <div style={{ position: 'relative' }}>
      {/* Soft mesh wash sits behind everything; sections stay readable via
          surfaces rather than the backdrop. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(60% 40% at 20% 0%, color-mix(in srgb, var(--brand-primary) 12%, transparent), transparent 70%), radial-gradient(50% 40% at 90% 10%, color-mix(in srgb, var(--brand-accent) 10%, transparent), transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative' }}>
        <header className="shell-header">
          <div className="shell-container">
            <div className="shell-navbar" style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-card)', padding: '0.75rem 1rem', boxShadow: '0 10px 30px -18px color-mix(in srgb, var(--text-primary) 45%, transparent)' }}>
              <a href="/" style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>
                {brandName}
              </a>
              <ul className="shell-nav-links">
                {nav.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    <a href={item.href}>{item.label}</a>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <MobileNavToggle nav={nav} cta={cta} />
                {cta ? (
                  <a className="shell-btn" href={cta.href}>
                    {cta.label}
                  </a>
                ) : null}
              </div>
            </div>
            {phoneHref ? (
              <div className="shell-eyebrow" style={{ paddingBlock: '0.5rem' }}>
                <a href={phoneHref} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {phone}
                </a>
              </div>
            ) : null}
          </div>
        </header>
        <main className="shell-main">{children}</main>
        <Footer props={props} />
      </div>
      <span hidden>{genome.shell_archetype}</span>
    </div>
  );
}

export function WarmOrganicShell(props: ShellProps) {
  const { children, brandName, nav, cta, phone, genome } = props;
  const phoneHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;
  return (
    <div>
      <header className="shell-header" style={{ background: 'var(--bg-canvas)' }}>
        <div className="shell-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', paddingBlock: '1.1rem' }}>
          <a href="/" style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>
            {brandName}
          </a>
          <ul className="shell-nav-links">
            {nav.map((item) => (
              <li key={`${item.href}-${item.label}`}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <MobileNavToggle nav={nav} cta={cta} />
            {cta ? (
              <a className="shell-btn" href={cta.href} style={{ borderRadius: '9999px' }}>
                {cta.label}
              </a>
            ) : null}
          </div>
        </div>
        {phoneHref ? (
          <div className="shell-container">
            <div className="shell-eyebrow" style={{ paddingBottom: '0.75rem' }}>
              <a href={phoneHref} style={{ color: 'inherit', textDecoration: 'none' }}>
                {phone}
              </a>
            </div>
          </div>
        ) : null}
      </header>
      <main className="shell-main">{children}</main>
      {/* Organic: curved divider into the footer instead of a hard edge. */}
      <svg viewBox="0 0 1440 80" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: '70px', color: 'var(--bg-contrast)' }} aria-hidden>
        <path d="M0 80 C 360 0 1080 0 1440 80 Z" fill="currentColor" />
      </svg>
      <Footer props={props} />
      <span hidden>{genome.shell_archetype}</span>
    </div>
  );
}

export function BentoModularShell(props: ShellProps) {
  const { children, brandName, nav, cta, phone, genome } = props;
  const phoneHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;
  return (
    <div>
      <header className="shell-header" style={{ background: 'var(--bg-canvas)', borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 10%, transparent)' }}>
        <div className="shell-container">
          <div className="shell-navbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', paddingBlock: '0.75rem' }}>
            <a href="/" style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>
              {brandName}
            </a>
            <ul className="shell-nav-links">
              {nav.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <MobileNavToggle nav={nav} cta={cta} />
              {phoneHref ? (
                <a className="shell-eyebrow" href={phoneHref} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {phone}
                </a>
              ) : null}
              {cta ? (
                <a className="shell-btn" href={cta.href}>
                  {cta.label}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      {/* Bento: content grid runs edge to edge with 16px gutters. */}
      <main className="shell-main" style={{ padding: '16px' }}>
        {children}
      </main>
      <Footer props={props} />
      <span hidden>{genome.shell_archetype}</span>
    </div>
  );
}

export const SHELLS = {
  'editorial-magazine': EditorialMagazineShell,
  'swiss-brutalist': SwissBrutalistShell,
  'clinical-glass': ClinicalGlassShell,
  'warm-organic': WarmOrganicShell,
  'bento-modular': BentoModularShell,
} as const;