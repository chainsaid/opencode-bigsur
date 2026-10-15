import { Database, type SQLQueryBindings } from "bun:sqlite"
import { existsSync } from "node:fs"
import { Context, Effect, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { classifySqliteError, SqlError } from "effect/sql/SqlError"
import { Sqlite } from "./sqlite.js"

// macOS: bun ships a bundled SQLite (3.32.x) that predates RETURNING (needs >= 3.35),
// which opencode relies on via drizzle `.returning()`. Point bun:sqlite at a full
// system SQLite (e.g. Homebrew) BEFORE any database is opened — bun exposes this via
// `Database.setCustomSQLite(path)` and it can only be set before SQLite is loaded.
// Override the library path with OPENCODE_SQLITE_LIB; falls back to bun's bundled
// SQLite when the library is absent or the API is unavailable (older bun).
try {
  if (
    process.platform === "darwin" &&
    typeof (Database as { setCustomSQLite?: unknown }).setCustomSQLite === "function"
  ) {
    const lib = process.env.OPENCODE_SQLITE_LIB ?? "/usr/local/opt/sqlite/lib/libsqlite3.0.dylib"
    if (existsSync(lib)) (Database as unknown as { setCustomSQLite: (path: string) => void }).setCustomSQLite(lib)
  }
} catch {
  // ignore: keep using bun's bundled SQLite
}

const TypeId = "~@opencode/core/database/SqliteBun" as const

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
export const supportsForeignKeyToggle = true

interface Config extends Sqlite.ClientConfig {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as Database

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = native.query<Record<string, unknown>, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.all(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<unknown[]>, SqlError>((fiber) => {
        const statement = native.query<unknown, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.values(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const connection = Sqlite.makeConnection(run, runValues, {
      export: Effect.try({
        try: () => native.serialize(),
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to export database", operation: "export" }),
          }),
      }),
      loadExtension: (path: string) =>
        Effect.try({
          try: () => native.loadExtension(path),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
            }),
        }),
    })

    return yield* Sqlite.makeClient(options, connection, TypeId, (acquirer) => ({
      export: Effect.flatMap(acquirer, (_) => _.export),
      loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
    }))
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new Database(config.filename, {
        readonly: config.readonly,
        readwrite: config.readwrite ?? true,
        create: config.create ?? true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true) native.run("PRAGMA journal_mode = WAL;")
      return native
    }),
  )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
