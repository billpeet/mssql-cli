# mssql-cli

A Microsoft SQL Server CLI tool designed for AI agent use and automation scripts. Outputs JSON by default, accepts all input via flags (no interactive prompts), and enforces a read-only mode for safe query execution.

## Installation

```bash
npm install -g @billpeet/mssql-cli
```

Or run locally without installing:

```bash
npm run build
node bin/mssql.js --help
```

## Setup

Add a server configuration (connection is tested before saving):

```bash
mssql server add --name prod --server myserver.database.windows.net --database MyDb --user sa --password secret --encrypt --trust-cert
```

Config is saved to `~/.config/mssql-cli/config.json`. The first server added is automatically set as the default.

## Environment Variables

Define a transient server (named `env`) without touching the config file:

| Variable | Description |
|---|---|
| `MSSQL_SERVER` | SQL Server hostname or IP |
| `MSSQL_DATABASE` | Database name |
| `MSSQL_USER` | Login username |
| `MSSQL_PASSWORD` | Login password |
| `MSSQL_PORT` | Port (default: 1433) |
| `MSSQL_ENCRYPT` | `true` to enable TLS encryption |
| `MSSQL_TRUST_CERT` | `true` to trust self-signed certificates |
| `MSSQL_WINDOWS_AUTH` | `true` to use Windows Integrated Authentication |

When `MSSQL_SERVER` and `MSSQL_DATABASE` are set, they override the configured default server.

## Commands

### `mssql server add`

Add or update a server configuration. The connection is tested before saving.

```bash
mssql server add --name local --server localhost --database MyDb --user sa --password secret --trust-cert
mssql server add --name prod  --server prod.example.com --database ProdDb --user appuser --password secret --encrypt
mssql server add --name dev   --server dev.example.com --database DevDb --windows-auth
```

Options:
- `--name <alias>` — Name used to reference this server in `--server`
- `--server <host>` — Hostname or IP address
- `--database <db>` — Default database
- `--user <user>` — SQL Server login (omit for Windows auth)
- `--password <pass>` — SQL Server password
- `--port <n>` — Port number (default: 1433)
- `--encrypt` / `--no-encrypt` — Enable/disable TLS (default: enabled)
- `--trust-cert` — Trust self-signed server certificate
- `--windows-auth` — Use Windows Integrated Authentication

### `mssql server list`

List all configured servers.

```bash
mssql server list
mssql server list --format text
```

### `mssql server default`

Set which server is used when `--server` is not specified.

```bash
mssql server default --name prod
```

### `mssql server remove`

Remove a server configuration.

```bash
mssql server remove --name old-server
```

### `mssql server test`

Test a connection without running a query.

```bash
mssql server test
mssql server test --name prod
```

### `mssql server config`

View or update global settings.

```bash
mssql server config
mssql server config --max-rows 200
```

Options:
- `--max-rows <n>` — Maximum rows returned per query before truncation (default: 100)

---

### `mssql sql`

Run a **read-only** SQL query. Any statement containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `MERGE`, `EXEC`/`EXECUTE`, `GRANT`, `REVOKE`, `DENY`, or `xp_*` is rejected. Detection strips SQL comments and quoted identifiers before checking, so column names like `[update_date]` are not falsely flagged.

```bash
mssql sql --query "SELECT TOP 10 * FROM dbo.Users"
mssql sql --query "SELECT id, name FROM dbo.Orders WHERE status = 'open'" --server prod
mssql sql --query "WITH cte AS (SELECT * FROM dbo.Events) SELECT COUNT(*) FROM cte" --pretty
mssql sql --query "SELECT * FROM dbo.Users" --format text
```

Options:
- `--query <sql>` — SQL query to execute
- `--server <name>` — Server alias (default: configured default)
- `--format json|text` — Output format (default: `json`)
- `--pretty` — Pretty-print JSON output

If results exceed `maxRows`, the response includes a `truncated` flag and the actual total row count.

---

### `mssql sql-dangerous`

Run any SQL statement including data-modifying and DDL operations. Use this command explicitly when writes are required — the name is intentional.

```bash
mssql sql-dangerous --query "INSERT INTO dbo.Logs (msg) VALUES ('test')"
mssql sql-dangerous --query "UPDATE dbo.Users SET active = 0 WHERE id = 42"
mssql sql-dangerous --query "CREATE TABLE dbo.Temp (id INT PRIMARY KEY)"
mssql sql-dangerous --query "EXEC sp_rename 'dbo.OldTable', 'NewTable'"
```

Options: same as `mssql sql`.

---

### `mssql schema`

Get the full schema for one or more tables: columns with types, primary keys, foreign keys (both outgoing and incoming), and indexes. Accepts `table` or `schema.table` notation (defaults to `dbo` schema).

```bash
mssql schema Users
mssql schema dbo.Users
mssql schema Users Orders OrderItems --pretty
mssql schema hr.Employees hr.Departments --server prod --format text
```

---

## Output Format

### JSON (default)

All commands write JSON to stdout. Errors are written to stderr as `{"error": "..."}`.

**`mssql sql` result:**
```json
{
  "rows": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ],
  "rowCount": 2
}
```

**Truncated result:**
```json
{
  "rows": [...],
  "rowCount": 100,
  "truncated": true,
  "totalRows": 4823,
  "message": "Results truncated: showing 100 of 4823 rows. Refine your query with WHERE/TOP to reduce results."
}
```

**`mssql sql-dangerous` result:**
```json
{
  "rowsAffected": 3,
  "rows": [],
  "rowCount": 0
}
```

**`mssql schema` result:**
```json
{
  "tables": [
    {
      "tableName": "Orders",
      "schema": "dbo",
      "columns": [
        { "name": "id", "dataType": "int", "maxLength": null, "precision": 10, "scale": 0, "isNullable": false, "defaultValue": null, "ordinalPosition": 1 },
        { "name": "userId", "dataType": "int", "maxLength": null, "precision": 10, "scale": 0, "isNullable": false, "defaultValue": null, "ordinalPosition": 2 }
      ],
      "primaryKeys": ["id"],
      "foreignKeys": [
        { "columnName": "userId", "referencedSchema": "dbo", "referencedTable": "Users", "referencedColumn": "id", "constraintName": "FK_Orders_Users" }
      ],
      "referencedBy": [
        { "referencingSchema": "dbo", "referencingTable": "OrderItems", "referencingColumn": "orderId", "referencedColumn": "id", "constraintName": "FK_OrderItems_Orders" }
      ],
      "indexes": [
        { "indexName": "PK_Orders", "indexType": "CLUSTERED", "isUnique": true, "isPrimaryKey": true, "columns": ["id"] }
      ]
    }
  ]
}
```

### Human-readable text

```bash
mssql sql --query "SELECT * FROM dbo.Users" --format text
mssql schema Users --format text
mssql server list --format text
```

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (connection failure, blocked query, missing config, invalid input) |

## Usage with AI Agents

`mssql-cli` is designed to be called directly by AI agents. JSON output with no interactive prompts makes it straightforward to parse and chain:

```bash
# Explore the schema before querying
mssql schema Users Orders

# Run a safe read query
mssql sql --query "SELECT TOP 5 * FROM dbo.Users WHERE active = 1"

# Use a specific server for a write
mssql sql-dangerous --query "UPDATE dbo.Jobs SET status = 'done' WHERE id = 99" --server prod

# Query multiple tables and pipe to jq
mssql sql --query "SELECT id, name FROM dbo.Products" | jq '.[].name'
```

## Security Notes

- **Passwords are stored in plaintext** in `~/.config/mssql-cli/config.json`. Restrict file permissions or use environment variables in sensitive environments.
- The `sql` command's read-only enforcement is a client-side check. For strict read-only access, configure the SQL Server login with read-only database permissions.

## Development

```bash
# Run from source (no build step needed)
npm run dev -- sql --query "SELECT 1 AS n"

# Build TypeScript
npm run build

# Run built binary
node bin/mssql.js --help
```
