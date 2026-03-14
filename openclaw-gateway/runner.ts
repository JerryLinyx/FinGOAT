import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RunStageInput = {
  openclaw_repo_path: string;
  openclaw_home: string;
  agent_id: string;
  session_key: string;
  message: string;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function main() {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error("missing stdin payload");
  }

  const input = JSON.parse(raw) as RunStageInput;
  const repoPath = path.resolve(input.openclaw_repo_path);
  const homePath = path.resolve(input.openclaw_home);

  process.env.OPENCLAW_HOME = homePath;
  await fs.mkdir(homePath, { recursive: true });

  const agentModule = await import(
    pathToFileURL(path.join(repoPath, "src", "commands", "agent.ts")).href
  );
  const depsModule = await import(
    pathToFileURL(path.join(repoPath, "src", "cli", "deps.ts")).href
  );

  const runtime = {
    log: () => {},
    error: () => {},
    exit: (code: number) => {
      throw new Error(`openclaw runtime exit ${code}`);
    },
  };

  const result = await agentModule.agentCommand(
    {
      message: input.message,
      agentId: input.agent_id,
      sessionKey: input.session_key,
      deliver: false,
      senderIsOwner: true,
    },
    runtime,
    depsModule.createDefaultDeps(),
  );

  process.stdout.write(JSON.stringify({ result }, null, 2));
}

const entryHref =
  process.argv[1] != null ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (entryHref && import.meta.url === entryHref) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack || error));
    process.exit(1);
  });
}
