/** PostgREST default max rows per request (Supabase JS). */
export const SUPABASE_DEFAULT_PAGE_SIZE = 1000;

/**
 * Fetch all rows by paging with `.range(from, to)` (inclusive).
 * Use a stable `.order(...)` on the query to avoid duplicates while paging.
 */
export async function fetchAllPaginatedRows<T>(params: {
  pageSize?: number;
  fetchPage: (range: {
    from: number;
    to: number;
  }) => PromiseLike<{ data: T[] | null; error: unknown | null }>;
}): Promise<T[]> {
  const pageSize = params.pageSize ?? SUPABASE_DEFAULT_PAGE_SIZE;
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await params.fetchPage({
      from,
      to: from + pageSize - 1,
    });

    if (error) {
      throw error;
    }

    const page = data ?? [];
    allRows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}

/**
 * Delete all rows matching `selectQuery` by paging ids (PostgREST often caps DELETE at ~1000 rows).
 * `selectQuery` must return `id` and use a stable `.order("id")` when the table can exceed one page.
 */
export async function deleteAllPaginatedRows(params: {
  pageSize?: number;
  selectIds: (range: {
    from: number;
    to: number;
  }) => PromiseLike<{
    data: { id: string }[] | null;
    error: unknown | null;
  }>;
  deleteByIds: (
    ids: string[]
  ) => PromiseLike<{ error: unknown | null }>;
}): Promise<number> {
  const pageSize = params.pageSize ?? SUPABASE_DEFAULT_PAGE_SIZE;
  let totalDeleted = 0;

  while (true) {
    const { data, error } = await params.selectIds({
      from: 0,
      to: pageSize - 1,
    });

    if (error) {
      throw error;
    }

    const ids = (data ?? []).map((row) => row.id).filter(Boolean);

    if (ids.length === 0) {
      break;
    }

    const { error: deleteError } = await params.deleteByIds(ids);

    if (deleteError) {
      throw deleteError;
    }

    totalDeleted += ids.length;

    if (ids.length < pageSize) {
      break;
    }
  }

  return totalDeleted;
}

/** Delete rows by primary key in chunks (avoids oversized `.in()` lists). */
export async function deleteByIdsInBatches(params: {
  ids: string[];
  batchSize?: number;
  deleteByIds: (
    ids: string[]
  ) => PromiseLike<{ error: unknown | null }>;
}): Promise<number> {
  const batchSize = params.batchSize ?? 500;
  let totalDeleted = 0;

  for (let offset = 0; offset < params.ids.length; offset += batchSize) {
    const batch = params.ids.slice(offset, offset + batchSize);

    if (batch.length === 0) {
      continue;
    }

    const { error } = await params.deleteByIds(batch);

    if (error) {
      throw error;
    }

    totalDeleted += batch.length;
  }

  return totalDeleted;
}
