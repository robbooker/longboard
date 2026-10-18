// A tiny in-memory stand-in for the Supabase client: just the query shapes the RVOL alert
// cron and the scanner route use (select/insert/upsert/update/delete with eq/in/lt/order/limit).

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

const UNIQUE_KEYS: Record<string, string[]> = {
  rvol_alert_dispatches: ["alert_key"],
};

export class FakeDb {
  tables = new Map<string, Row[]>();

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  client() {
    return { from: (table: string) => this.from(table) };
  }
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private conflict: string[] = [];
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private max: number | null = null;
  private single = false;

  constructor(private db: FakeDb, private table: string) {}

  select() {
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = rows;
    this.conflict = (options?.onConflict ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => String(row[column]) < String(value));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter(row));
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    if (this.op === "insert") {
      const unique = UNIQUE_KEYS[this.table] ?? [];
      for (const row of [this.payload].flat() as Row[]) {
        if (unique.length && rows.some((existing) => unique.every((key) => existing[key] === row[key]))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      for (const row of [this.payload].flat() as Row[]) {
        const index = rows.findIndex((existing) => this.conflict.every((key) => existing[key] === row[key]));
        if (index >= 0) rows[index] = { ...rows[index], ...row };
        else rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === "update") {
      for (const row of rows) if (this.matches(row)) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      const kept = rows.filter((row) => !this.matches(row));
      rows.splice(0, rows.length, ...kept);
      return { data: null, error: null };
    }
    let out = rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
    if (this.orders.length) {
      out.sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const av = a[column] as number | string;
          const bv = b[column] as number | string;
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.max != null) out = out.slice(0, this.max);
    if (this.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}
