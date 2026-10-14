import { SHELL_ARCHETYPES, NAV_TOPOLOGIES, COLOR_MODES, RHYTHM_VARIANTS, FLEET_CAPACITY, SIMILARITY_LIMIT, PROVEN_WORST_CASE, PAIR_WINDOW, SHELL_PROFILES } from '@/lib/genome';

/**
 * Engine root. Deliberately not a marketing page: this URL is the engine, not a
 * tenant, so it reports the live anti-sameness configuration. Middleware never
 * rewrites the engine's own host, so this page is only ever seen by operators.
 */
export default function EngineRoot() {
  return (
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', maxWidth: '60rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '.25rem' }}>anagata-web-engine</h1>
      <p style={{ color: '#555' }}>
        Multi-tenant website + blog engine. One container, many client domains.
      </p>

      <h2 style={{ marginTop: '2.5rem' }}>Anti-sameness configuration</h2>
      <ul>
        <li><strong>Shells:</strong> {SHELL_ARCHETYPES.length} ({SHELL_ARCHETYPES.join(', ')})</li>
        <li><strong>Nav topologies:</strong> {NAV_TOPOLOGIES.length}</li>
        <li><strong>Colour modes:</strong> {COLOR_MODES.length}</li>
        <li><strong>Section rhythms:</strong> {RHYTHM_VARIANTS.length}</li>
        <li><strong>Structural combinations:</strong> {FLEET_CAPACITY.toLocaleString()}</li>
        <li><strong>Pair window:</strong> {PAIR_WINDOW} sites</li>
        <li><strong>Similarity limit:</strong> {SIMILARITY_LIMIT} (proven worst case {PROVEN_WORST_CASE})</li>
      </ul>

      <h2 style={{ marginTop: '2.5rem' }}>Shell profiles</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.9rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '.5rem' }}>Shell</th>
            <th style={{ padding: '.5rem' }}>Grid</th>
            <th style={{ padding: '.5rem' }}>Density</th>
            <th style={{ padding: '.5rem' }}>Sections</th>
          </tr>
        </thead>
        <tbody>
          {SHELL_ARCHETYPES.map((shell) => {
            const profile = SHELL_PROFILES[shell];
            return (
              <tr key={shell} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '.5rem' }}>{shell}</td>
                <td style={{ padding: '.5rem', color: '#555' }}>{profile.grid}</td>
                <td style={{ padding: '.5rem' }}>{profile.density}</td>
                <td style={{ padding: '.5rem' }}>{profile.max_sections}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ marginTop: '2.5rem' }}>Endpoints</h2>
      <ul>
        <li><code>GET /api/health</code> - liveness and env check</li>
        <li><code>GET|POST /api/genome</code> - design-genome service used by the site builder</li>
        <li><code>POST /api/compile</code> - MDX validation + Tailwind compilation gate</li>
        <li><code>POST /api/revalidate</code> - per-tenant cache invalidation</li>
        <li><code>POST /api/leads</code> - anti-spam lead capture</li>
      </ul>
    </main>
  );
}