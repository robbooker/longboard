// #385 A tiny in-memory stand-in for the Supabase client, covering only the calls the Reader routes
// make: select/eq/in/order/limit/maybeSingle, insert, upsert, update, delete, and the storage
// bucket's signed links and remove. Shared by the route unit tests and the browser test's server.
type Row = Record<string, unknown>;
const KEYS: Record<string, string[]> = { reader_books: ["id"], reader_progress: ["account_id", "book_id"] };

export function createReaderFakeDb(seed: { reader_books?: Row[]; reader_progress?: Row[] } = {}, storageBase = "https://storage.test") {
  const tables: Record<string, Row[]> = { reader_books: [...(seed.reader_books ?? [])], reader_progress: [...(seed.reader_progress ?? [])] };
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let op: { kind: "select" | "insert" | "upsert" | "update" | "delete"; value?: Row } = { kind: "select" };
    let orders: { column: string; ascending: boolean }[] = [];
    let limit = Infinity;
    let single = false;
    const run = () => {
      calls.push(`${op.kind}:${table}`);
      const rows = tables[table];
      if (op.kind === "insert") {
        rows.push({ ...op.value });
        return { data: null, error: null };
      }
      if (op.kind === "upsert") {
        const key = KEYS[table];
        const found = rows.find((row) => key.every((k) => row[k] === op.value![k]));
        if (found) Object.assign(found, op.value);
        else rows.push({ ...op.value });
        return { data: null, error: null };
      }
      const matched = rows.filter((row) => filters.every((f) => f(row)));
      if (op.kind === "update") {
        for (const row of matched) Object.assign(row, op.value);
        return { data: null, error: null };
      }
      if (op.kind === "delete") {
        tables[table] = rows.filter((row) => !matched.includes(row));
        if (table === "reader_books")
          tables.reader_progress = tables.reader_progress.filter((p) => !matched.some((b) => b.id === p.book_id));
        return { data: null, error: null };
      }
      let out = [...matched];
      for (const order of [...orders].reverse())
        out.sort((a, b) => (a[order.column]! < b[order.column]! ? -1 : a[order.column]! > b[order.column]! ? 1 : 0) * (order.ascending ? 1 : -1));
      out = out.slice(0, limit).map((row) => ({ ...row }));
      return { data: single ? (out[0] ?? null) : out, error: null };
    };
    const builder = {
      select: () => builder,
      insert: (value: Row) => ((op = { kind: "insert", value }), builder),
      upsert: (value: Row) => ((op = { kind: "upsert", value }), builder),
      update: (value: Row) => ((op = { kind: "update", value }), builder),
      delete: () => ((op = { kind: "delete" }), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      order: (column: string, options?: { ascending?: boolean }) => ((orders = [...orders, { column, ascending: options?.ascending !== false }]), builder),
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  const signed = (path: string) => `${storageBase}/signed/${path}?token=t`;
  const storage = {
    from: () => ({
      createSignedUrl: async (path: string) => ({ data: { signedUrl: signed(path) }, error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: signed(path), error: null })), error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `${storageBase}/upload/${path}?token=u`, path, token: "u" }, error: null }),
      remove: async (paths: string[]) => {
        for (const path of paths) files.delete(path);
        return { data: [], error: null };
      },
    }),
  };
  return { db: { from, storage }, tables, files, calls, signed };
}
