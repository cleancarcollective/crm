/**
 * Stateless pagination strip for directory pages. Renders prev/next plus
 * Page X of Y. Preserves query params via the buildHref callback so search
 * + status filters survive the navigation.
 *
 * Uses plain <a> rather than next/link — Next.js 15 typed routes don't
 * accept dynamically-built strings, and full navigation is fine here
 * (we want the server query to re-run with the new page number anyway).
 */
type Props = {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
};

export function DirectoryPagination({ page, totalPages, buildHref }: Props) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  return (
    <nav className="directoryPagination" aria-label="Directory pagination">
      <a
        href={prev !== null ? buildHref(prev) : undefined}
        aria-disabled={prev === null}
        className={`directoryPaginationLink${prev === null ? " directoryPaginationLink--disabled" : ""}`}
      >
        ← Previous
      </a>
      <span className="directoryPaginationLabel">
        Page {page} of {totalPages}
      </span>
      <a
        href={next !== null ? buildHref(next) : undefined}
        aria-disabled={next === null}
        className={`directoryPaginationLink${next === null ? " directoryPaginationLink--disabled" : ""}`}
      >
        Next →
      </a>
    </nav>
  );
}
