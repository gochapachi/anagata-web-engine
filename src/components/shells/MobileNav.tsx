'use client';

import { useEffect, useState } from 'react';

/**
 * Mobile navigation drawer.
 *
 * The shells render a horizontal nav bar whose links hide below 768px, so on a
 * phone there was NO way to move between pages at all - zero navigation. This
 * adds the hamburger + slide-over the audit flagged as missing.
 *
 * Rendered by every shell next to its nav so the behaviour is consistent
 * across all six archetypes.
 */
export function MobileNavToggle({ nav, cta }: { nav: { label: string; href: string }[]; cta?: { label: string; href: string } | null }) {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the drawer is open, and close it on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!nav.length && !cta) return null;

  return (
    <>
      <button
        type="button"
        className="shell-nav-toggle"
        aria-expanded={open}
        aria-controls="shell-mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        style={{
          alignItems: 'center',
          background: 'transparent',
          border: '1px solid color-mix(in srgb, var(--text-primary) 18%, transparent)',
          borderRadius: 'var(--radius-button)',
          color: 'inherit',
          cursor: 'pointer',
          display: 'none',
          gap: '.45rem',
          padding: '.45rem .7rem',
        }}
      >
        {/* Three lines that morph into an X via CSS when [aria-expanded] */}
        <span aria-hidden style={{ display: 'grid', gap: '4px' }}>
          <span style={{ background: 'currentColor', display: 'block', height: '1.5px', width: '18px' }} />
          <span style={{ background: 'currentColor', display: 'block', height: '1.5px', width: '18px' }} />
          <span style={{ background: 'currentColor', display: 'block', height: '1.5px', width: '18px' }} />
        </span>
        <span className="shell-eyebrow">Menu</span>
      </button>

      {open ? (
        <div
          id="shell-mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          onClick={() => setOpen(false)}
          style={{
            background: 'color-mix(in srgb, var(--bg-canvas) 82%, black 18%)',
            inset: 0,
            position: 'fixed',
            zIndex: 90,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)',
              borderBottomLeftRadius: 'var(--radius-card)',
              borderBottomRightRadius: 'var(--radius-card)',
              boxShadow: '0 24px 60px rgba(0,0,0,.28)',
              display: 'grid',
              gap: '.25rem',
              padding: '1.25rem',
            }}
          >
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
              <span className="shell-eyebrow">Navigate</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: '1.4rem',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            <nav aria-label="Primary (mobile)" style={{ display: 'grid', gap: '.1rem', marginTop: '.5rem' }}>
              {nav.map((item) => (
                <a
                  key={`m-${item.href}-${item.label}`}
                  href={item.href}
                  style={{
                    color: 'inherit',
                    fontFamily: 'var(--font-heading)',
                    fontSize: '1.15rem',
                    padding: '.7rem .25rem',
                    textDecoration: 'none',
                  }}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            {cta ? (
              <a className="shell-btn" href={cta.href} style={{ justifyContent: 'center', marginTop: '.75rem' }}>
                {cta.label}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}