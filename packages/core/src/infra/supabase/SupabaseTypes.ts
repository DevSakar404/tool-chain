/**
 * Minimal structural type for the Supabase client interface.
 * Using a local interface avoids importing @supabase/supabase-js in core,
 * keeping the core package free of Supabase as a dependency.
 */
export interface SupabaseDb {
  from(table: string): SupabaseQueryBuilder;
  storage: {
    from(bucket: string): SupabaseBucket;
  };
}

export interface SupabaseQueryBuilder extends PromiseLike<{ data: Record<string, unknown> | null; error: SupabaseError | null }> {
  select(columns: string): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  single(): Promise<{ data: Record<string, unknown> | null; error: SupabaseError | null }>;
  insert(data: Record<string, unknown>): Promise<{ error: SupabaseError | null }>;
  upsert(data: Record<string, unknown>): Promise<{ error: SupabaseError | null }>;
  update(data: Record<string, unknown>): SupabaseQueryBuilder;
}

export interface SupabaseBucket {
  upload(
    key: string,
    data: Buffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ error: SupabaseError | null }>;
  download(key: string): Promise<{ data: Blob; error: SupabaseError | null }>;
  remove(keys: string[]): Promise<{ error: SupabaseError | null }>;
}

export interface SupabaseError {
  message: string;
  code?: string | undefined;
}

/**
 * Loose, assignment-friendly view of the Supabase client used ONLY at the
 * `buildEngine` boundary. The real `SupabaseClient` from @supabase/supabase-js
 * carries heavily-generic `from()` / `storage.from()` signatures that are not
 * structurally assignable to the precise `SupabaseDb` contract above. This type
 * asks for nothing more than "has a `from` method and a `storage.from` method",
 * which the real client trivially satisfies, so callers pass `createClient(...)`
 * with no cast. The narrowing to `SupabaseDb` happens once inside `buildEngine`.
 */
export interface SupabaseClientLike {
  from(table: string): unknown;
  storage: {
    from(bucket: string): unknown;
  };
}
