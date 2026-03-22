import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const stateRoot = path.resolve(
  process.env.OPENCLAW_GATEWAY_STATE_DIR || path.join(projectRoot, "openclaw-gateway", "state"),
);
const openClawRepoPath = path.resolve(
  process.env.OPENCLAW_REPO_PATH || path.join(projectRoot, "..", "openclaw"),
);
const port = Number.parseInt(process.env.OPENCLAW_GATEWAY_PORT || "8011", 10);
const defaultModel = process.env.OPENCLAW_DEFAULT_MODEL || "ollama/gemma3:1b";
const runTimeoutMs = Number.parseInt(process.env.OPENCLAW_GATEWAY_RUN_TIMEOUT_MS || "300000", 10);
const registryPath = path.join(stateRoot, "registry.json");
const runnerPath = path.join(projectRoot, "openclaw-gateway", "runner.ts");

const ANALYST_KINDS = [
  "market",
  "social",
  "news",
  "fundamentals",
  "portfolio_manager",
  "trader_plan",
  "risk_management",
];
const STAGE_LABELS = {
  market: "Market Analyst",
  social: "Social Analyst",
  news: "News Analyst",
  fundamentals: "Fundamentals Analyst",
  portfolio_manager: "Portfolio Manager",
  trader_plan: "Trader Plan",
  risk_management: "Risk Management",
};
const SKILL_TEMPLATES = {
  market: ["financial-data", "market-structure"],
  social: ["sentiment-monitoring", "social-signal-triage"],
  news: ["news-synthesis", "macro-headlines"],
  fundamentals: ["fundamental-analysis", "financial-statements"],
  portfolio_manager: ["portfolio-construction", "capital-allocation"],
  trader_plan: ["trade-planning", "execution-playbooks"],
  risk_management: ["risk-controls", "position-governance"],
};

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectOpenClawRuntime() {
  const hasPackage = await pathExists(path.join(openClawRepoPath, "package.json"));
  const hasNodeModules = await pathExists(path.join(openClawRepoPath, "node_modules"));
  return {
    ready: hasPackage && hasNodeModules,
    mode: hasPackage && hasNodeModules ? "source-tsx" : "unavailable",
    has_package: hasPackage,
    has_node_modules: hasNodeModules,
  };
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf-8").trim();
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

function safeSegment(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "user";
}

function computeUserRoot(userId) {
  return path.join(stateRoot, "users", safeSegment(userId));
}

function computeAgentRecord(userId, analystKind) {
  const safeUser = safeSegment(userId);
  const safeKind = safeSegment(analystKind);
  const userRoot = computeUserRoot(userId);
  const workspacePath = path.join(userRoot, "workspaces", safeKind);
  const sessionRoot = path.join(userRoot, ".openclaw", "agents", `${safeUser}-${safeKind}-analyst`);
  return {
    user_id: String(userId),
    analyst_kind: safeKind,
    openclaw_agent_id: `${safeUser}-${safeKind}-analyst`,
    workspace_path: workspacePath,
    session_root: sessionRoot,
    skill_template_version: "v1",
    status: "ready",
    skills: SKILL_TEMPLATES[safeKind] || [],
  };
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function loadRegistry() {
  try {
    const payload = await fs.readFile(registryPath, "utf-8");
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return { users: {} };
}

async function saveRegistry(registry) {
  await ensureDir(path.dirname(registryPath));
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

function buildOpenClawConfig(agentRecords) {
  return {
    agents: {
      defaults: {
        model: {
          primary: defaultModel,
        },
      },
      list: agentRecords.map((record, index) => ({
        id: record.openclaw_agent_id,
        name: STAGE_LABELS[record.analyst_kind] || record.analyst_kind,
        workspace: record.workspace_path,
        agentDir: record.session_root,
        default: index === 0,
      })),
    },
  };
}

async function writeOpenClawConfig(userId, agentRecords) {
  const userRoot = computeUserRoot(userId);
  const configDir = path.join(userRoot, ".openclaw");
  const configPath = path.join(configDir, "openclaw.json");
  await ensureDir(configDir);
  await fs.writeFile(configPath, JSON.stringify(buildOpenClawConfig(agentRecords), null, 2), "utf-8");
  return configPath;
}

async function ensureAgents(userId) {
  if (!userId) {
    throw new Error("user_id is required");
  }

  const registry = await loadRegistry();
  const userKey = String(userId);
  const existing = registry.users[userKey] || {};

  const records = ANALYST_KINDS.map((kind) => existing[kind] || computeAgentRecord(userKey, kind));
  for (const record of records) {
    await ensureDir(record.workspace_path);
    await ensureDir(record.session_root);
  }

  const configPath = await writeOpenClawConfig(userKey, records);
  registry.users[userKey] = Object.fromEntries(records.map((record) => [record.analyst_kind, record]));
  await saveRegistry(registry);

  return {
    user_id: userKey,
    config_path: configPath,
    agents: records,
  };
}

function buildStagePrompt(payload) {
  const upstreamOutputs = payload.upstream_outputs && typeof payload.upstream_outputs === "object"
    ? payload.upstream_outputs
    : {};
  const instructions = payload.instructions || {};
  if (typeof instructions.stage_prompt === "string" && instructions.stage_prompt.trim()) {
    return instructions.stage_prompt;
  }
  return [
    `You are the ${STAGE_LABELS[payload.stage_id] || payload.stage_id} for FinGOAT.`,
    `Produce a focused analyst report for ${payload.ticker} on ${payload.analysis_date}.`,
    "",
    "Requirements:",
    "- Return plain Markdown.",
    "- Start with a short executive summary.",
    "- Cite concrete evidence and uncertainties.",
    "- End with downstream implications for later analysts.",
    "- Do not output JSON fences.",
    "",
    `Ticker: ${payload.ticker}`,
    `Analysis date: ${payload.analysis_date}`,
    `Stage id: ${payload.stage_id}`,
    "",
    "Upstream outputs:",
    JSON.stringify(upstreamOutputs, null, 2),
    "",
    "Execution context:",
    JSON.stringify(
      {
        llm_config: payload.llm_config || {},
        data_vendor_config: payload.data_vendor_config || {},
        instructions,
        output_schema_version: payload.output_schema_version || "v1",
      },
      null,
      2,
    ),
  ].join("\n");
}

function summarizeText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 220 ? `${normalized.slice(0, 219)}...` : normalized;
}

function extractTextFromAgentResult(result) {
  const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
  const parts = [];
  for (const payload of payloads) {
    if (typeof payload?.text === "string" && payload.text.trim()) {
      parts.push(payload.text.trim());
    }
  }
  if (parts.length > 0) {
    return parts.join("\n\n");
  }
  if (typeof result?.summary === "string" && result.summary.trim()) {
    return result.summary.trim();
  }
  return "";
}

async function runOpenClawStage(payload, agentRecord) {
  const runtime = await detectOpenClawRuntime();
  if (!runtime.ready) {
    throw new Error("agent_bootstrap_failed: OpenClaw runtime is not ready; install gateway dependencies first");
  }

  const userRoot = computeUserRoot(payload.user_id);
  const sessionKey = `agent:${agentRecord.openclaw_agent_id}:web:analysis:${payload.task_id}:${payload.stage_id}`;
  const startedAt = new Date().toISOString();
  const requestPayload = {
    openclaw_repo_path: openClawRepoPath,
    openclaw_home: userRoot,
    agent_id: agentRecord.openclaw_agent_id,
    session_key: sessionKey,
    message: buildStagePrompt(payload),
  };

  const child = spawn(
    process.execPath,
    ["--import", "tsx", runnerPath],
    {
      cwd: openClawRepoPath,
      env: {
        ...process.env,
        OPENCLAW_REPO_PATH: openClawRepoPath,
        OPENCLAW_HOME: userRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const stdoutChunks = [];
  const stderrChunks = [];
  const timeoutHandle = setTimeout(() => {
    child.kill("SIGTERM");
  }, runTimeoutMs);

  child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  child.stdin.write(JSON.stringify(requestPayload));
  child.stdin.end();

  const exitResult = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: -1, error }));
    child.on("close", (code, signal) => resolve({ code: code ?? 0, signal }));
  });
  clearTimeout(timeoutHandle);

  const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
  const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max((Date.parse(completedAt) - Date.parse(startedAt)) / 1000, 0);

  if (exitResult.error) {
    throw new Error(`openclaw runner failed to start: ${String(exitResult.error)}`);
  }
  if (exitResult.code !== 0) {
    throw new Error(stderr || stdout || `openclaw runner exited with code ${exitResult.code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`invalid runner response: ${stdout || stderr || String(error)}`);
  }

  const content = extractTextFromAgentResult(parsed.result || parsed);
  if (!content) {
    throw new Error("agent_output_invalid: OpenClaw returned no text payload");
  }

  return {
    stage_id: payload.stage_id,
    label: STAGE_LABELS[payload.stage_id] || payload.stage_id,
    status: "completed",
    backend: "openclaw",
    provider: payload.llm_config?.provider || "unknown",
    agent_id: agentRecord.openclaw_agent_id,
    session_key: sessionKey,
    content,
    summary: summarizeText(content),
    raw_output: parsed,
    started_at: startedAt,
    completed_at: completedAt,
    duration_seconds: durationSeconds,
    error: null,
  };
}

async function handleEnsureAgents(req, res) {
  const body = await readJsonBody(req);
  const result = await ensureAgents(body.user_id);
  jsonResponse(res, 200, result);
}

async function handleAgentStatus(res, userId) {
  const registry = await loadRegistry();
  const userEntry = registry.users[String(userId)];
  if (!userEntry) {
    jsonResponse(res, 404, { error: "agent registry not found" });
    return;
  }

  const userRoot = computeUserRoot(userId);
  const configPath = path.join(userRoot, ".openclaw", "openclaw.json");
  jsonResponse(res, 200, {
    user_id: String(userId),
    status: "ready",
    config_path: configPath,
    agents: Object.values(userEntry),
  });
}

async function handleRunStage(req, res) {
  const body = await readJsonBody(req);
  const userId = String(body.user_id || "").trim();
  const stageId = safeSegment(body.stage_id);
  if (!userId) {
    jsonResponse(res, 400, { error: "user_id is required" });
    return;
  }
  if (!ANALYST_KINDS.includes(stageId)) {
    jsonResponse(res, 400, { error: `unsupported stage_id ${body.stage_id}` });
    return;
  }

  const ensured = await ensureAgents(userId);
  const agentRecord = ensured.agents.find((record) => record.analyst_kind === stageId);
  if (!agentRecord) {
    jsonResponse(res, 500, { error: `agent_bootstrap_failed: missing agent record for ${stageId}` });
    return;
  }

  try {
    const stage = await runOpenClawStage(
      {
        ...body,
        user_id: userId,
        stage_id: stageId,
      },
      agentRecord,
    );
    jsonResponse(res, 200, stage);
  } catch (error) {
    jsonResponse(res, 502, {
      stage_id: stageId,
      label: STAGE_LABELS[stageId] || stageId,
      status: "failed",
      backend: "openclaw",
      provider: body.llm_config?.provider || "unknown",
      agent_id: agentRecord.openclaw_agent_id,
      session_key: `agent:${agentRecord.openclaw_agent_id}:web:analysis:${body.task_id}:${stageId}`,
      content: null,
      summary: null,
      raw_output: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: `agent_run_failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function handleHealth(res) {
  let registryWritable = true;
  try {
    await ensureDir(stateRoot);
    const probePath = path.join(stateRoot, `.health-${crypto.randomUUID()}.tmp`);
    await fs.writeFile(probePath, "ok", "utf-8");
    await fs.rm(probePath, { force: true });
  } catch {
    registryWritable = false;
  }

  const openclawRuntime = await detectOpenClawRuntime();

  jsonResponse(res, 200, {
    status: registryWritable && openclawRuntime.ready ? "healthy" : "degraded",
    service: "openclaw-gateway",
    timestamp: new Date().toISOString(),
    state_root: stateRoot,
    openclaw_repo_path: openClawRepoPath,
    agent_registry_store_reachable: registryWritable,
    session_store_writable: registryWritable,
    auth_profile_resolution_status: "external",
    worker_run_queue_status: "per-request subprocess",
    openclaw_repo_present: openclawRuntime.has_package,
    openclaw_runtime_ready: openclawRuntime.ready,
    openclaw_runtime_mode: openclawRuntime.mode,
    openclaw_node_modules_present: openclawRuntime.has_node_modules,
    default_model: defaultModel,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      jsonResponse(res, 404, { error: "not found" });
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      await handleHealth(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/internal/openclaw/agents/ensure") {
      await handleEnsureAgents(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/internal/openclaw/stages/run") {
      await handleRunStage(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/internal/openclaw/agents/status/")) {
      const userId = decodeURIComponent(url.pathname.split("/").pop() || "");
      await handleAgentStatus(res, userId);
      return;
    }

    jsonResponse(res, 404, { error: "not found" });
  } catch (error) {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`openclaw-gateway listening on http://127.0.0.1:${port}`);
});
