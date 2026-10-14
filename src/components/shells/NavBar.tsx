import './shell.css';
import type { NavItem } from './types';
import type React from 'react';

/** Header markup shared by the horizontal nav topologies. */
export function NavBar({
  topology,
  brandName,
  nav,
  cta,
  phone,
}: {
  topology: string;
  brandName: string;
  nav: NavItem[];
  cta?: { label: string; href: string } | null;
  phone?: string;
}) {
  const links = (
    <ul className="shell-nav-links">
      {nav.map((item) => (
        <li key={`${item.href}-${item.label}`}>
          <a href={item.href}>{item.label}</a>
        </li>
      ))}
    </ul>
  );

  if (topology === 'utility-strip') {
    return (
      <>
        <div className="shell-utility">
          <div className="shell-container" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{phone ?? brandName}</span>
            <span>{cta?.label ?? 'Contact'}</span>
          </div>
        </div>
        <div className="shell-container">
          <div className="shell-navbar">
            <Brand brandName={brandName} />
            {links}
            {cta ? (
              <a className="shell-btn" href={cta.href}>
                {cta.label}
              </a>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  if (topology === 'split-centered') {
    const half = Math.ceil(nav.length / 2);
    return (
      <div className="shell-container">
        <div className="shell-navbar">
          <div className="shell-nav-left">
            <ul className="shell-nav-links">
              {nav.slice(0, half).map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </div>
          <Brand brandName={brandName} />
          <div className="shell-nav-right">
            <ul className="shell-nav-links">
              {nav.slice(half).map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (topology === 'mega-matrix') {
    return (
      <div className="shell-container">
        <div className="shell-matrix-top">
          <Brand brandName={brandName} />
          {cta ? (
            <a className="shell-btn" href={cta.href}>
              {cta.label}
            </a>
          ) : null}
        </div>
        <nav className="shell-matrix-row" aria-label="Primary">
          {nav.map((item) => (
            <a key={`${item.href}-${item.label}`} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    );
  }

  if (topology === 'command-bar') {
    return (
      <div className="shell-container">
        <div className="shell-navbar">
          <Brand brandName={brandName} />
          {links}
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}>
            {phone ?? ''}
          </span>
        </div>
      </div>
    );
  }

  if (topology === 'overlay-drawer') {
    return (
      <div className="shell-container">
        <div className="shell-navbar">
          <Brand brandName={brandName} />
          <button className="shell-menu-button" type="button" aria-expanded="false">
            Menu
          </button>
        </div>
      </div>
    );
  }

  // floating-pill, hairline-bar and the default all share this body.
  return (
    <div className="shell-container">
      <div className="shell-navbar">
        <Brand brandName={brandName} />
        {links}
        {cta ? (
          <a className="shell-btn" href={cta.href}>
            {cta.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Brand({ brandName }: { brandName: string }) {
  return (
    <a
      href="/"
      style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1.25rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      {brandName}
    </a>
  );
}