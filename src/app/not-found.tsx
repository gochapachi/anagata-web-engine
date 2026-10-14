import { notFound } from 'next/navigation';

/**
 * Root 404. A request that reaches here was not rewritten to a tenant, which
 * means the host is unknown to the engine - so it must not leak any tenant
 * information back to the caller.
 */
export default function NotFound() {
  notFound();
}