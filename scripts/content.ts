import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { exportContent, importContent } from "../lib/content/store";
import { getDb } from "../lib/db";
import { cliDeveloperContext } from "../lib/developer";

interface Flags {
  command: string;
  file?: string;
  out?: string;
  publish: boolean;
  notes?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { command: argv[0] ?? "", publish: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file" || arg === "-f") {
      flags.file = argv[++index];
    } else if (arg === "--out" || arg === "-o") {
      flags.out = argv[++index];
    } else if (arg === "--notes") {
      flags.notes = argv[++index];
    } else if (arg === "--publish") {
      flags.publish = true;
    }
  }
  return flags;
}

function usage(): never {
  console.error(`Usage:
  npm run content:export -- [--out content/export.json]
  npm run content:import -- --file content/export.json [--publish] [--notes "message"]

Import validates the pack, saves it as the draft, and only publishes with
--publish. Requires DEVELOPER_EMAILS (or ADMIN_EMAILS) and DATABASE_PATH.`);
  process.exit(1);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const db = getDb();
  const context = cliDeveloperContext(db);

  if (flags.command === "export") {
    const payload = exportContent(context, db);
    const out = resolve(
      flags.out ?? `content/export-${new Date().toISOString().slice(0, 10)}.json`,
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(
      `Exported ${payload.source} content (v${payload.version ?? "bundled"}) to ${out}`,
    );
    return;
  }

  if (flags.command === "import") {
    if (!flags.file) usage();
    const raw = readFileSync(resolve(flags.file), "utf8");
    const parsed = JSON.parse(raw) as {
      kind?: string;
      pack?: unknown;
    };
    const packInput = parsed.kind === "codequest-content-pack" ? parsed.pack : parsed;
    const result = importContent(context, db, {
      pack: packInput,
      publish: flags.publish,
      notes: flags.notes ?? `Imported from ${flags.file}`,
    });
    console.log(
      `Imported draft v${result.draftVersion}${
        result.publishedVersion ? ` and published v${result.publishedVersion}` : " (not published)"
      }.`,
    );
    return;
  }

  usage();
}

try {
  main();
} catch (error) {
  console.error(
    `content ${process.argv[2] ?? ""} failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
