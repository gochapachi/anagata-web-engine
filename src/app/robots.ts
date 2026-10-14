import type { MetadataRoute } from 'next';

/** Engine-level robots: the engine itself must never be indexed. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}