import { Pool, type QueryResultRow } from "pg";
import { config } from "../config.js";

type QueryOperation = "select" | "insert" | "update" | "delete" | "upsert";

interface SupabaseLikeError {
  message: string;
  code?: string;
  details?: string;
}

interface SupabaseLikeResponse {
  data: any;
  error: SupabaseLikeError | null;
  count?: number | null;
}

interface SelectOptions {
  count?: "exact";
  head?: boolean;
}

interface EqCondition {
  type: "eq";
  column: string;
  value: unknown;
}

interface IlikeCondition {
  type: "ilike";
  column: string;
  value: string;
}

interface OrCondition {
  type: "or";
  clauses: IlikeCondition[];
}

type Condition = EqCondition | IlikeCondition | OrCondition;

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_URL.includes("railway.internal")
    ? undefined
    : { rejectUnauthorized: false },
});

const allowedTables = new Set([
  "users",
  "user_preferences",
  "user_channel_subscriptions",
  "channels",
  "videos",
  "summaries",
  "brain_objects",
  "user_context",
  "delivery_log",
  "jobs",
]);

function asPgError(err: unknown): SupabaseLikeError {
  if (err instanceof Error) {
    const maybeCode = (err as { code?: string }).code;
    return { message: err.message, code: maybeCode };
  }
  return { message: String(err) };
}

function noRowsError(): SupabaseLikeError {
  return {
    message: "No rows found",
    code: "PGRST116",
  };
}

function assertSafeIdentifier(value: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
}

function quoteIdent(value: string): string {
  assertSafeIdentifier(value);
  return `"${value}"`;
}

function qualify(column: string, table?: string): string {
  const quoted = quoteIdent(column);
  return table ? `${quoteIdent(table)}.${quoted}` : quoted;
}

function splitSelectColumns(input: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth++;
    if (char === ")") depth--;

    if (char === "," && depth === 0) {
      columns.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) columns.push(current.trim());
  return columns;
}

function columnsToSql(columns: string, table?: string): string {
  const trimmed = columns.trim();
  if (!trimmed || trimmed === "*") {
    return table ? `${quoteIdent(table)}.*` : "*";
  }

  return splitSelectColumns(trimmed)
    .filter((column) => column !== "*")
    .map((column) => qualify(column, table))
    .join(", ");
}

function hasRelation(columns: string, relation: string): boolean {
  return splitSelectColumns(columns).some((column) => column.startsWith(relation));
}

class PgQueryBuilder implements PromiseLike<SupabaseLikeResponse> {
  private operation: QueryOperation | null = null;
  private selectColumns = "*";
  private returningColumns: string | null = null;
  private selectOptions: SelectOptions | undefined;
  private conditions: Condition[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;
  private singleRow = false;
  private mutationRows: Record<string, unknown>[] = [];
  private mutationValues: Record<string, unknown> = {};
  private conflictColumns: string[] = [];

  constructor(private readonly table: string) {
    if (!allowedTables.has(table)) {
      throw new Error(`Unsupported table: ${table}`);
    }
  }

  select(columns = "*", options?: SelectOptions): this {
    if (!this.operation) {
      this.operation = "select";
      this.selectColumns = columns;
      this.selectOptions = options;
      return this;
    }

    this.returningColumns = columns || "*";
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = "insert";
    this.mutationRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.mutationValues = values;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  upsert(row: Record<string, unknown>, options?: { onConflict?: string }): this {
    this.operation = "upsert";
    this.mutationRows = [row];
    this.conflictColumns = (options?.onConflict ?? "id")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    return this;
  }

  eq(column: string, value: unknown): this {
    this.conditions.push({ type: "eq", column, value });
    return this;
  }

  ilike(column: string, value: string): this {
    this.conditions.push({ type: "ilike", column, value });
    return this;
  }

  or(filter: string): this {
    const clauses = filter
      .split(",")
      .map((part) => part.trim())
      .map((part) => {
        const match = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.ilike\.(.*)$/);
        if (!match) return null;
        return { type: "ilike" as const, column: match[1], value: match[2] };
      })
      .filter((clause): clause is IlikeCondition => Boolean(clause));

    if (clauses.length) this.conditions.push({ type: "or", clauses });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  single(): this {
    this.singleRow = true;
    return this;
  }

  then<TResult1 = SupabaseLikeResponse, TResult2 = never>(
    onfulfilled?: ((value: SupabaseLikeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhere(params: unknown[], table?: string): string {
    if (!this.conditions.length) return "";

    const parts = this.conditions.map((condition) => {
      if (condition.type === "eq") {
        if (condition.value === null || typeof condition.value === "undefined") {
          return `${qualify(condition.column, table)} IS NULL`;
        }
        params.push(condition.value);
        return `${qualify(condition.column, table)} = $${params.length}`;
      }

      if (condition.type === "ilike") {
        params.push(condition.value);
        return `${qualify(condition.column, table)} ILIKE $${params.length}`;
      }

      const orParts = condition.clauses.map((clause) => {
        params.push(clause.value);
        return `${qualify(clause.column, table)} ILIKE $${params.length}`;
      });
      return `(${orParts.join(" OR ")})`;
    });

    return ` WHERE ${parts.join(" AND ")}`;
  }

  private buildOrder(table?: string): string {
    if (!this.orderBy) return "";
    const direction = this.orderBy.ascending ? "ASC" : "DESC";
    return ` ORDER BY ${qualify(this.orderBy.column, table)} ${direction}`;
  }

  private buildLimit(params: unknown[]): string {
    if (!this.rowLimit) return "";
    params.push(this.rowLimit);
    return ` LIMIT $${params.length}`;
  }

  private async execute(): Promise<SupabaseLikeResponse> {
    try {
      switch (this.operation ?? "select") {
        case "select":
          return await this.executeSelect();
        case "insert":
          return await this.executeInsert();
        case "update":
          return await this.executeUpdate();
        case "delete":
          return await this.executeDelete();
        case "upsert":
          return await this.executeUpsert();
      }
    } catch (err) {
      return { data: null, error: asPgError(err), count: null };
    }
  }

  private async executeSelect(): Promise<SupabaseLikeResponse> {
    const params: unknown[] = [];
    const shouldCount = this.selectOptions?.count === "exact" && this.selectOptions?.head;

    if (shouldCount) {
      const countSql = `SELECT COUNT(*)::int AS count FROM ${quoteIdent(this.table)}${this.buildWhere(params)}`;
      const result = await pool.query<{ count: number }>(countSql, params);
      return { data: null, error: null, count: result.rows[0]?.count ?? 0 };
    }

    const joinsVideos = this.table === "summaries" && hasRelation(this.selectColumns, "videos!");
    const includesSummaries = this.table === "videos" && hasRelation(this.selectColumns, "summaries");

    const baseSelect = joinsVideos
      ? `${quoteIdent("summaries")}.*, json_build_object('title', ${qualify("title", "videos")}, 'category', ${qualify("category", "videos")}) AS videos`
      : columnsToSql(this.selectColumns.replace(/,\s*summaries\([^)]*\)/, ""), this.table);

    let sql = `SELECT ${baseSelect} FROM ${quoteIdent(this.table)}`;
    if (joinsVideos) {
      sql += ` INNER JOIN ${quoteIdent("videos")} ON ${qualify("id", "videos")} = ${qualify("video_id", "summaries")}`;
    }
    sql += this.buildWhere(params, joinsVideos ? this.table : undefined);
    sql += this.buildOrder(joinsVideos ? this.table : undefined);
    sql += this.buildLimit(params);

    const result = await pool.query(sql, params);
    let rows = result.rows;

    if (includesSummaries && rows.length) {
      const videoIds = rows.map((row) => row.id);
      const summaryResult = await pool.query(
        `SELECT * FROM ${quoteIdent("summaries")} WHERE ${quoteIdent("video_id")} = ANY($1::uuid[])`,
        [videoIds]
      );
      const summariesByVideoId = new Map<string, any[]>();
      for (const summary of summaryResult.rows) {
        const summaries = summariesByVideoId.get(summary.video_id) ?? [];
        summaries.push(summary);
        summariesByVideoId.set(summary.video_id, summaries);
      }
      rows = rows.map((row) => ({
        ...row,
        summaries: summariesByVideoId.get(row.id) ?? [],
      }));
    }

    return this.formatRows(rows);
  }

  private async executeInsert(): Promise<SupabaseLikeResponse> {
    if (!this.mutationRows.length) return { data: null, error: null };

    const columns = Array.from(new Set(this.mutationRows.flatMap((row) => Object.keys(row))));
    if (!columns.length) throw new Error("Insert requires at least one column");

    const params: unknown[] = [];
    const valuesSql = this.mutationRows
      .map((row) => {
        const placeholders = columns.map((column) => {
          params.push(row[column] ?? null);
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");

    const returning = this.returningColumns
      ? ` RETURNING ${columnsToSql(this.returningColumns)}`
      : "";
    const sql = `INSERT INTO ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(", ")}) VALUES ${valuesSql}${returning}`;
    const result = await pool.query(sql, params);

    if (!this.returningColumns) return { data: null, error: null };
    return this.formatRows(result.rows);
  }

  private async executeUpdate(): Promise<SupabaseLikeResponse> {
    const columns = Object.keys(this.mutationValues);
    if (!columns.length) throw new Error("Update requires at least one column");

    const params: unknown[] = [];
    const setSql = columns
      .map((column) => {
        params.push(this.mutationValues[column] ?? null);
        return `${quoteIdent(column)} = $${params.length}`;
      })
      .join(", ");

    const returning = this.returningColumns
      ? ` RETURNING ${columnsToSql(this.returningColumns)}`
      : "";
    const sql = `UPDATE ${quoteIdent(this.table)} SET ${setSql}${this.buildWhere(params)}${returning}`;
    const result = await pool.query(sql, params);

    if (!this.returningColumns) return { data: null, error: null };
    return this.formatRows(result.rows);
  }

  private async executeDelete(): Promise<SupabaseLikeResponse> {
    const params: unknown[] = [];
    const where = this.buildWhere(params);
    if (!where) throw new Error("Delete without a filter is not allowed");

    const sql = `DELETE FROM ${quoteIdent(this.table)}${where}`;
    await pool.query(sql, params);
    return { data: null, error: null };
  }

  private async executeUpsert(): Promise<SupabaseLikeResponse> {
    const row = this.mutationRows[0];
    if (!row) return { data: null, error: null };

    const columns = Object.keys(row);
    if (!columns.length) throw new Error("Upsert requires at least one column");
    if (!this.conflictColumns.length) throw new Error("Upsert requires conflict columns");

    const params = columns.map((column) => row[column] ?? null);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updateColumns = columns.filter((column) => !this.conflictColumns.includes(column));
    const conflictSql = this.conflictColumns.map(quoteIdent).join(", ");
    const actionSql = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}`
      : "DO NOTHING";
    const returning = this.returningColumns
      ? ` RETURNING ${columnsToSql(this.returningColumns)}`
      : "";

    const sql = `INSERT INTO ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflictSql}) ${actionSql}${returning}`;
    const result = await pool.query(sql, params);

    if (!this.returningColumns) return { data: null, error: null };
    return this.formatRows(result.rows);
  }

  private formatRows(rows: any[]): SupabaseLikeResponse {
    if (this.singleRow) {
      const row = rows[0] ?? null;
      return row
        ? { data: row, error: null }
        : { data: null, error: noRowsError() };
    }

    return { data: rows, error: null };
  }
}

export const supabase = {
  from(table: string): PgQueryBuilder {
    return new PgQueryBuilder(table);
  },
};

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
) {
  return pool.query<T>(sql, params);
}

export async function ensureDatabaseSchema(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    DO $$
    BEGIN
      CREATE TYPE digest_category AS ENUM (
        'investing',
        'psychology',
        'podcast_interview',
        'seo_marketing',
        'tech_ai_startup'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      CREATE TYPE transcript_status AS ENUM ('pending', 'available', 'unavailable');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      CREATE TYPE brain_object_type AS ENUM (
        'principle',
        'rule',
        'playbook',
        'anti_pattern',
        'mental_model',
        'pattern'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      CREATE TYPE confidence_level AS ENUM (
        'stated_as_fact',
        'strong_opinion',
        'speculation'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_user_id text NOT NULL UNIQUE,
      telegram_chat_id text NOT NULL UNIQUE,
      username text,
      display_name text,
      timezone text NOT NULL DEFAULT 'UTC',
      plan text NOT NULL DEFAULT 'free',
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile_context text,
      output_format text,
      delivery_mode text NOT NULL DEFAULT 'manual',
      max_auto_digests_per_day integer NOT NULL DEFAULT 3,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS channels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      youtube_channel_id text NOT NULL UNIQUE,
      name text NOT NULL,
      thumbnail_url text,
      rss_feed_url text,
      active boolean NOT NULL DEFAULT true,
      default_category digest_category,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_channel_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      default_category digest_category,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS videos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
      youtube_video_id text NOT NULL UNIQUE,
      title text NOT NULL,
      published_at timestamptz,
      duration_seconds integer,
      thumbnail_url text,
      processed boolean NOT NULL DEFAULT false,
      category digest_category,
      transcript_status transcript_status NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      video_id uuid NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
      tldr text,
      key_learnings text[],
      applicable_to_me text[],
      action_items text[],
      quotable_moments text[],
      skip_assessment text,
      raw_transcript text,
      model_used text,
      tokens_used integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS brain_objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type brain_object_type NOT NULL,
      content text NOT NULL,
      author text,
      source_video_id uuid REFERENCES videos(id) ON DELETE CASCADE,
      channel_name text,
      category text,
      context text,
      confidence confidence_level,
      tags text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_context (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      label text NOT NULL UNIQUE,
      context text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS delivery_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      summary_id uuid REFERENCES summaries(id) ON DELETE SET NULL,
      telegram_chat_id text,
      telegram_message_id text,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      priority integer NOT NULL DEFAULT 100,
      run_after timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_until timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      payload jsonb NOT NULL,
      idempotency_key text UNIQUE,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id);
    CREATE INDEX IF NOT EXISTS idx_user_channel_subscriptions_user_id ON user_channel_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_channel_subscriptions_channel_id ON user_channel_subscriptions(channel_id);
    CREATE INDEX IF NOT EXISTS idx_user_channel_subscriptions_active ON user_channel_subscriptions(active);
    CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(active);
    CREATE INDEX IF NOT EXISTS idx_videos_processed ON videos(processed);
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_transcript_status ON videos(transcript_status);
    CREATE INDEX IF NOT EXISTS idx_summaries_video_id ON summaries(video_id);
    CREATE INDEX IF NOT EXISTS idx_brain_objects_type ON brain_objects(type);
    CREATE INDEX IF NOT EXISTS idx_brain_objects_source_video_id ON brain_objects(source_video_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after ON jobs(status, run_after, priority);
    CREATE INDEX IF NOT EXISTS idx_jobs_locked_until ON jobs(locked_until);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `);
}
