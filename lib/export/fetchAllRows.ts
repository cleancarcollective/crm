/**
 * PostgREST (Supabase) caps every response at 1000 rows by default, so a
 * single .select() silently drops everything past row 1000. Exports need
 * the full set, so they page through with .range() until a short batch.
 *
 * `build` must return a fresh query each call, with a stable .order() so
 * pages don't overlap or skip rows.
 */
const PAGE_SIZE = 1000;

type PagedResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PagedResult<T>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}
