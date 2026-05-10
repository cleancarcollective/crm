import Link from "next/link";

/**
 * Stateless pagination strip for directory pages. Renders prev/next plus
 * Page X of Y. Preserves query params via the buildHref callback so search
 * + status filters survive the navigation.
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
      <Link
        href={prev !== null ? buildHref(prev) : "#"}
        aria-disabled={prev === null}
        className={`directoryPaginationLink${prev === null ? " directoryPaginationLink--disabled" : ""}`}
      >
        ← Previous
      </Link>
      <span className="directoryPaginationLabel">
        Page {page} of {totalPages}
      </span>
      <Link
        href={next !== null ? buildHref(next) : "#"}
        aria-disabled={next === null}
        className={`directoryPaginationLink${next === null ? " directoryPaginationLink--disabled" : ""}`}
      >
        Next →
      </Link>
    </nav>
  );
}
