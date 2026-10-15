/**
 * Interactive blocks the AI-authored MDX may use, plus the MDX component map.
 *
 * These are the ONLY components available to generated content. Keeping the map
 * closed means a hallucinated import cannot break a render, and it is what makes
 * "the AI writes MDX, not React" safe: everything it can reach is server-rendered,
 * styled from genome tokens, and typed.
 */

import {
  Reveal,
  Parallax,
  StatCounter,
  TiltCard,
  StickyScene,
  ScrollProgress,
  Marquee,
} from '@/components/motion';

export interface QuickSummaryProps {
  points?: string[];
  title?: string;
}

export function QuickSummary({ points = [], title = 'Key takeaways' }: QuickSummaryProps) {
  if (!points.length) return null;
  return (
    <aside
      className="mdx-summary"
      style={{
        border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
        borderLeft: '3px solid var(--brand-primary)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-surface)',
        padding: '1.25rem 1.5rem',
        margin: '2rem 0',
      }}
    >
      <strong style={{ fontFamily: 'var(--font-heading)', display: 'block', marginBottom: '.5rem' }}>
        {title}
      </strong>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '.4rem' }}>
        {points.map((point) => (
          <li key={point} style={{ color: 'var(--text-muted)' }}>
            {point}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export interface CostRow {
  label: string;
  detail?: string;
  price?: string;
}

export function CostComparisonTable({
  title = 'Cost comparison',
  rows = [],
}: {
  title?: string;
  rows?: CostRow[];
}) {
  if (!rows.length) return null;
  return (
    <figure style={{ margin: '2rem 0', overflowX: 'auto' }}>
      <figcaption className="shell-eyebrow" style={{ marginBottom: '.5rem' }}>
        {title}
      </figcaption>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.95rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid color-mix(in srgb, var(--text-primary) 20%, transparent)' }}>
            <th style={{ textAlign: 'left', padding: '.6rem .5rem' }}>Option</th>
            <th style={{ textAlign: 'left', padding: '.6rem .5rem' }}>Details</th>
            <th style={{ textAlign: 'right', padding: '.6rem .5rem' }}>Indicative cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.label}-${row.price}`} style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 10%, transparent)' }}>
              <td style={{ padding: '.6rem .5rem', fontWeight: 600 }}>{row.label}</td>
              <td style={{ padding: '.6rem .5rem', color: 'var(--text-muted)' }}>{row.detail}</td>
              <td style={{ padding: '.6rem .5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface FaqItem {
  q: string;
  a: string;
}

export function FaqAccordion({ items = [], title = 'Frequently asked questions' }: { items?: FaqItem[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section style={{ margin: '2.5rem 0' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem' }}>{title}</h2>
      <div style={{ display: 'grid', gap: '.5rem' }}>
        {items.map((item) => (
          <details
            key={item.q}
            style={{
              border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
              borderRadius: 'var(--radius-card)',
              padding: '.9rem 1.1rem',
              background: 'var(--bg-surface)',
            }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{item.q}</summary>
            <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function DoctorReviewedBadge({
  name,
  credentials,
  date,
}: {
  name?: string;
  credentials?: string;
  date?: string;
}) {
  if (!name) return null;
  return (
    <p
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '.5rem',
        alignItems: 'center',
        fontSize: '.85rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        paddingBlock: '.75rem',
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>Reviewed by {name}</strong>
      {credentials ? <span>{credentials}</span> : null}
      {date ? <span>· {date}</span> : null}
    </p>
  );
}

export function Callout({ type = 'note', children }: { type?: 'note' | 'tip' | 'warning'; children?: React.ReactNode }) {
  const tone = type === 'warning' ? 'var(--brand-accent)' : 'var(--brand-primary)';
  return (
    <div
      style={{
        borderLeft: `3px solid ${tone}`,
        background: 'color-mix(in srgb, var(--bg-surface) 92%, var(--brand-primary))',
        borderRadius: 'var(--radius-card)',
        padding: '1rem 1.25rem',
        margin: '1.75rem 0',
      }}
    >
      {children}
    </div>
  );
}

export function InlineLeadCTA({
  ctaText = 'Request an appointment',
  service = '',
  phone = '',
}: {
  ctaText?: string;
  service?: string;
  phone?: string;
}) {
  return (
    <aside
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        background: 'var(--bg-contrast)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius-card)',
        padding: '1.25rem 1.5rem',
        margin: '2.25rem 0',
      }}
    >
      <div>
        <strong style={{ fontFamily: 'var(--font-heading)', display: 'block' }}>{ctaText}</strong>
        {service ? <span style={{ opacity: 0.8, fontSize: '.9rem' }}>{service}</span> : null}
      </div>
      <a className="shell-btn" href={phone ? `tel:${phone}` : '/contact'}>
        {phone ? `Call ${phone}` : 'Get in touch'}
      </a>
    </aside>
  );
}

/** Comparison slider for before/after proof. Pure CSS, no client JS needed. */
export function BeforeAfterComparison({
  beforeImg,
  afterImg,
  label = 'Before / after',
}: {
  beforeImg: string;
  afterImg: string;
  label?: string;
}) {
  if (!beforeImg || !afterImg) return null;
  return (
    <figure style={{ margin: '2rem 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem' }}>
        <img src={beforeImg} alt={`${label} - before`} loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-card)' }} />
        <img src={afterImg} alt={`${label} - after`} loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-card)' }} />
      </div>
      <figcaption className="shell-eyebrow" style={{ marginTop: '.5rem' }}>
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * The closed component map handed to `MDXRemote`. Adding a component here is the
 * only way AI-authored MDX can reach it.
 *
 * NOTE ON CLIENT COMPONENTS: the motion primitives below are the map's only
 * 'use client' entries. They are safe to expose because the agent still cannot
 * inject code — it names a component and passes serialisable props, and the
 * behaviour itself lives in engine source. Each one degrades to static content
 * if JS never runs, so exposing them cannot produce a blank page.
 */
export const MDX_COMPONENTS = {
  QuickSummary,
  CostComparisonTable,
  FaqAccordion,
  DoctorReviewedBadge,
  Callout,
  InlineLeadCTA,
  BeforeAfterComparison,
  // Motion / 3D primitives (src/components/motion)
  Reveal,
  Parallax,
  StatCounter,
  TiltCard,
  StickyScene,
  ScrollProgress,
  Marquee,
} as const;

/** Used by the workflow prompt so the agent knows exactly what it may emit. */
export const MDX_COMPONENT_NAMES = Object.keys(MDX_COMPONENTS);