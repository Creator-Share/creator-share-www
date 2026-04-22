#!/usr/bin/env python3
"""
Parse a pg_dump SQL file and extract a normalized schema inventory.

Outputs a sorted, deterministic summary of:
  - Tables with columns (name, type, nullable, default)
  - Enum types with values
  - Indexes (name, table, definition)
  - Triggers (name, table, timing, events, function)
  - Functions (name, args, return type)
  - Foreign key constraints
  - Unique constraints

Usage:
  python3 parse-schema.py <dump.sql> [--output <file>]
  python3 parse-schema.py dump_041426.sql --output prod-schema.txt
"""

import re
import sys
from collections import defaultdict
from pathlib import Path


def parse_dump(filepath: str) -> dict:
    text = Path(filepath).read_text(encoding="utf-8", errors="replace")

    schema = {
        "tables": {},        # table_name -> [(col, type, nullable, default)]
        "enums": {},         # enum_name -> [values]
        "indexes": [],       # [(name, table, unique, definition)]
        "triggers": [],      # [(name, table, timing, events, function)]
        "functions": [],     # [(name, args, returns, body_hash)]
        "fk_constraints": [],# [(name, table, columns, ref_table, ref_columns, on_delete)]
        "unique_constraints": [],  # [(name, table, columns)]
        "rls_enabled": [],   # [table_name]
        "policies": [],      # [(name, table, command, permissive, roles, qual)]
    }

    # ── Enums ──────────────────────────────────────────────────────────
    # CREATE TYPE public.foo AS ENUM ('a', 'b', 'c');
    for m in re.finditer(
        r"CREATE\s+TYPE\s+(?:public\.)?([\w\"]+)\s+AS\s+ENUM\s*\((.+?)\)",
        text, re.IGNORECASE | re.DOTALL
    ):
        name = m.group(1).strip('"')
        values = re.findall(r"'([^']+)'", m.group(2))
        # Keep the longest (most complete) definition if there are duplicates
        if name not in schema["enums"] or len(values) > len(schema["enums"][name]):
            schema["enums"][name] = values

    # Also catch ALTER TYPE ... ADD VALUE statements
    for m in re.finditer(
        r"ALTER\s+TYPE\s+(?:public\.)?([\w\"]+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'",
        text, re.IGNORECASE
    ):
        name = m.group(1).strip('"')
        value = m.group(2)
        if name not in schema["enums"]:
            schema["enums"][name] = []
        if value not in schema["enums"][name]:
            schema["enums"][name].append(value)

    # ── Tables & Columns ───────────────────────────────────────────────
    # Match CREATE TABLE blocks
    table_pattern = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([\w\"]+)\s*\("
        r"(.*?)\)\s*;",
        re.IGNORECASE | re.DOTALL
    )
    for m in table_pattern.finditer(text):
        table_name = m.group(1).strip('"')
        body = m.group(2)

        # Skip supabase internal tables
        if table_name.startswith("_") or table_name in (
            "schema_migrations", "seed_files", "secrets",
            "decrypted_secrets", "spatial_ref_sys"
        ):
            continue

        columns = []
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            if not line or line.upper().startswith(("CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "EXCLUDE")):
                continue
            # Parse column definition
            col_match = re.match(
                r'^"?([\w]+)"?\s+([\w\s\[\](),.]+?)(?:\s+(NOT\s+NULL|NULL))?(?:\s+DEFAULT\s+(.+?))?$',
                line, re.IGNORECASE
            )
            if col_match:
                col_name = col_match.group(1)
                col_type = col_match.group(2).strip()
                nullable = "NOT NULL" if col_match.group(3) and "NOT" in col_match.group(3).upper() else "NULL"
                default = col_match.group(4).strip() if col_match.group(4) else None
                columns.append((col_name, col_type, nullable, default))

        if columns:
            schema["tables"][table_name] = columns

    # ── ALTER TABLE ADD COLUMN (catches columns added after CREATE TABLE) ──
    for m in re.finditer(
        r"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?([\w\"]+)\s+"
        r"ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\"?([\w]+)\"?\s+"
        r"([\w\s\[\](),.]+?)(?:\s+(NOT\s+NULL|NULL))?(?:\s+DEFAULT\s+(.+?))?\s*;",
        text, re.IGNORECASE
    ):
        table = m.group(1).strip('"')
        col = m.group(2)
        ctype = m.group(3).strip()
        nullable = "NOT NULL" if m.group(4) and "NOT" in m.group(4).upper() else "NULL"
        default = m.group(5).strip() if m.group(5) else None
        if table in schema["tables"]:
            # Check if column already exists
            existing = [c[0] for c in schema["tables"][table]]
            if col not in existing:
                schema["tables"][table].append((col, ctype, nullable, default))

    # ── Indexes ────────────────────────────────────────────────────────
    for m in re.finditer(
        r"CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w\"]+)\s+"
        r"ON\s+(?:public\.)?([\w\"]+)\s*(?:USING\s+\w+\s*)?\(([^)]+)\)"
        r"(?:\s+WHERE\s+(.+?))?\s*;",
        text, re.IGNORECASE
    ):
        unique = bool(m.group(1))
        idx_name = m.group(2).strip('"')
        table = m.group(3).strip('"')
        columns = m.group(4).strip()
        where = m.group(5).strip() if m.group(5) else None
        definition = f"({columns})"
        if where:
            definition += f" WHERE {where}"
        schema["indexes"].append((idx_name, table, unique, definition))

    # ── Triggers ───────────────────────────────────────────────────────
    for m in re.finditer(
        r"CREATE\s+TRIGGER\s+([\w\"]+)\s+"
        r"(BEFORE|AFTER|INSTEAD\s+OF)\s+"
        r"([\w\s,OR]+?)\s+ON\s+(?:public\.)?([\w\"]+)\s+"
        r".*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([\w.\"]+)\s*\(",
        text, re.IGNORECASE | re.DOTALL
    ):
        name = m.group(1).strip('"')
        timing = m.group(2).upper()
        events = " ".join(m.group(3).upper().split())
        table = m.group(4).strip('"')
        func = m.group(5).strip('"').replace("public.", "")
        schema["triggers"].append((name, table, timing, events, func))

    # ── Functions ──────────────────────────────────────────────────────
    # Capture function signatures
    for m in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([\w\"]+)\s*\(([^)]*)\)\s+"
        r"RETURNS\s+([\w\s.\"]+?)(?:\s+LANGUAGE|\s+AS)",
        text, re.IGNORECASE
    ):
        name = m.group(1).strip('"')
        args = m.group(2).strip()
        returns = m.group(3).strip()
        # Normalize args
        if args:
            # Simplify to just types
            arg_parts = []
            for arg in args.split(","):
                arg = arg.strip()
                parts = arg.split()
                if len(parts) >= 2:
                    arg_parts.append(parts[-1])  # last word is usually the type
                elif parts:
                    arg_parts.append(parts[0])
            args = ", ".join(arg_parts)
        schema["functions"].append((name, args, returns))

    # ── Foreign Keys ───────────────────────────────────────────────────
    # ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ...
    for m in re.finditer(
        r"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?([\w\"]+)\s+"
        r"ADD\s+CONSTRAINT\s+([\w\"]+)\s+"
        r"FOREIGN\s+KEY\s*\(([^)]+)\)\s+"
        r"REFERENCES\s+(?:public\.|auth\.)?([\w\"]+)\s*\(([^)]+)\)"
        r"(?:\s+ON\s+DELETE\s+(\w+(?:\s+\w+)?))?",
        text, re.IGNORECASE
    ):
        table = m.group(1).strip('"')
        name = m.group(2).strip('"')
        columns = m.group(3).strip()
        ref_table = m.group(4).strip('"')
        ref_columns = m.group(5).strip()
        on_delete = m.group(6).strip().upper() if m.group(6) else "NO ACTION"
        schema["fk_constraints"].append((name, table, columns, ref_table, ref_columns, on_delete))

    # ── RLS ────────────────────────────────────────────────────────────
    for m in re.finditer(
        r"ALTER\s+TABLE\s+(?:public\.)?([\w\"]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        text, re.IGNORECASE
    ):
        table = m.group(1).strip('"')
        schema["rls_enabled"].append(table)

    # ── Policies ───────────────────────────────────────────────────────
    for m in re.finditer(
        r"CREATE\s+POLICY\s+\"?([\w\s]+?)\"?\s+ON\s+(?:public\.)?([\w\"]+)\s+"
        r"(?:AS\s+(\w+)\s+)?(?:FOR\s+(\w+)\s+)?(?:TO\s+([\w,\s]+?)\s+)?"
        r"(?:USING\s*\((.+?)\))?\s*(?:WITH\s+CHECK\s*\((.+?)\))?\s*;",
        text, re.IGNORECASE | re.DOTALL
    ):
        name = m.group(1).strip()
        table = m.group(2).strip('"')
        permissive = (m.group(3) or "PERMISSIVE").upper()
        command = (m.group(4) or "ALL").upper()
        roles = (m.group(5) or "public").strip()
        schema["policies"].append((name, table, command, permissive, roles))

    return schema


def format_schema(schema: dict) -> str:
    lines = []

    lines.append("=" * 70)
    lines.append("ENUMS")
    lines.append("=" * 70)
    for name in sorted(schema["enums"]):
        values = ", ".join(schema["enums"][name])
        lines.append(f"  {name}: {values}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("TABLES")
    lines.append("=" * 70)
    for table in sorted(schema["tables"]):
        lines.append(f"\n  {table}:")
        for col, ctype, nullable, default in schema["tables"][table]:
            default_str = f" DEFAULT {default}" if default else ""
            lines.append(f"    {col:30s} {ctype:25s} {nullable:8s}{default_str}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("INDEXES")
    lines.append("=" * 70)
    for name, table, unique, definition in sorted(schema["indexes"], key=lambda x: (x[1], x[0])):
        uq = "UNIQUE " if unique else ""
        lines.append(f"  {table:30s} {uq}{name}: {definition}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("FOREIGN KEYS")
    lines.append("=" * 70)
    for name, table, columns, ref_table, ref_columns, on_delete in sorted(schema["fk_constraints"], key=lambda x: (x[1], x[0])):
        lines.append(f"  {table}.{columns} -> {ref_table}.{ref_columns}  [{name}] ON DELETE {on_delete}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("TRIGGERS")
    lines.append("=" * 70)
    for name, table, timing, events, func in sorted(schema["triggers"], key=lambda x: (x[1], x[0])):
        lines.append(f"  {table:30s} {timing} {events}: {func}()")

    lines.append("")
    lines.append("=" * 70)
    lines.append("FUNCTIONS")
    lines.append("=" * 70)
    for name, args, returns in sorted(schema["functions"], key=lambda x: x[0]):
        lines.append(f"  {name}({args}) -> {returns}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("RLS ENABLED")
    lines.append("=" * 70)
    for table in sorted(schema["rls_enabled"]):
        lines.append(f"  {table}")

    lines.append("")
    lines.append("=" * 70)
    lines.append("POLICIES")
    lines.append("=" * 70)
    for name, table, command, permissive, roles in sorted(schema["policies"], key=lambda x: (x[1], x[0])):
        lines.append(f"  {table:30s} {command:8s} {permissive:12s} {name} (to: {roles})")

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <dump.sql> [--output <file>]", file=sys.stderr)
        sys.exit(1)

    dump_file = sys.argv[1]
    output_file = None
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]

    schema = parse_dump(dump_file)
    result = format_schema(schema)

    if output_file:
        Path(output_file).write_text(result)
        print(f"Schema written to {output_file}")
    else:
        print(result)
