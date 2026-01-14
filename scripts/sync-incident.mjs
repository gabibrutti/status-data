import fs from "node:fs/promises";
import path from "node:path";

const STATUS_PATH = path.resolve("status.json");

const SUPPORTED_SERVICES = [
  "Interconexão entre Data Centers (SP1 e SP2)",
  "Datacenter SP2",
  "Datacenter SP1",
  "ACS (Apache Cloud Stack)",
  "vCloud",
  "Central Telefônica",
  "Freshservice (painel de chamados)",
  "Under Control (Painel administrativo)",
  "VPN - Gerência console servidores físico Under",
];
const SUPPORTED_SERVICES_SET = new Set(SUPPORTED_SERVICES);

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY;

if (!token) throw new Error("Missing GITHUB_TOKEN");
if (!repoFull) throw new Error("Missing GITHUB_REPOSITORY");

const [owner, repo] = repoFull.split("/");
if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repoFull}`);

const priority = {
  operational: 0,
  degraded: 1,
  maintenance: 2,
  partial: 3,
  major: 4,
};

function extractSection(body, heading) {
  if (!body) return "";
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `###\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|$)`,
    "i"
  );
  const m = body.match(re);
  return (m?.[1] ?? "").trim();
}

/**
 * Normaliza a lista de serviços:
 * - aceita itens em linhas separadas OU numa mesma linha separados por vírgula
 * - remove bullets "- " / "* "
 * - faz trim e elimina vazios
 */
function parseServices(servicesRaw) {
  if (!servicesRaw) return [];

  return servicesRaw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseIssueForm(body) {
  const severityRaw = extractSection(body, "Severidade").split("\n")[0].trim();
  const servicesRaw = extractSection(body, "Serviços afetados");
  const description = extractSection(body, "Descrição do incidente");
  const update = extractSection(body, "Atualização (opcional)");

  const rawServices = parseServices(servicesRaw);

  // mantém só serviços suportados
  const mappedServices = rawServices.filter((s) => SUPPORTED_SERVICES_SET.has(s));

  const severity = ["degraded", "partial", "major", "maintenance"].includes(severityRaw)
    ? severityRaw
    : "degraded";

  // mensagem pode ser vazia (a UI decide se mostra ou não)
  const message = [description, update].filter(Boolean).join("\n\n").trim();

  return { severity, services: mappedServices, message };
}

async function githubRequest(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "status-data-bot",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  return await res.json();
}

async function listAllIssues() {
  // até 100 issues (ok pra status page)
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=created&direction=desc`;
  const issues = await githubRequest(url);
  return issues.filter((i) => !i.pull_request);
}

function isTrustedIssue(issue) {
  const assoc = (issue?.author_association || "").toUpperCase();
  return assoc === "OWNER" || assoc === "MEMBER" || assoc === "COLLABORATOR";
}

function isIncidentIssue(issue) {
  const title = (issue?.title || "").trim();
  return /^\[INCIDENTE\]/i.test(title);
}

function cleanIncidentTitle(title) {
  return (title || "").replace(/^\[INCIDENTE\]\s*/i, "").trim();
}

/**
 * Busca comentários da issue (updates) e normaliza
 * - retorna lista com { id, author, body, created_at, updated_at, url }
 */
async function fetchAllIssueComments(issueNumber) {
  const perPage = 100;
  let page = 1;
  const all = [];

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${perPage}&page=${page}`;
    const data = await githubRequest(url);

    all.push(...data);

    if (!Array.isArray(data) || data.length < perPage) break;
    page += 1;

    // proteção simples pra não ficar absurdo em issues gigantes
    if (page > 10) break; // 1000 comentários no máx.
  }

  // Normaliza e filtra vazios
  const normalized = all
    .map((c) => ({
      id: c.id,
      author: c.user?.login || "unknown",
      body: (c.body || "").trim(),
      created_at: c.created_at,
      updated_at: c.updated_at,
      url: c.html_url,
      // se quiser filtrar bots depois:
      // is_bot: !!c.user?.type && c.user.type.toLowerCase() === "bot"
    }))
    .filter((c) => c.body.length > 0);

  // opcional: limita a quantidade salva no status.json (evita crescer demais)
  const MAX_UPDATES = 30;
  return normalized.slice(-MAX_UPDATES);
}

function computeOverallServices(baseServices, openIncidents) {
  // começa tudo operacional
  const next = {};
  for (const s of Object.keys(baseServices)) next[s] = "operational";

  // aplica severidade do pior incidente por serviço
  for (const inc of openIncidents) {
    const sev = inc.status;
    for (const s of inc.services) {
      if ((priority[sev] ?? 0) > (priority[next[s]] ?? 0)) {
        next[s] = sev;
      }
    }
  }

  return next;
}

async function toIncidentRecord(issue) {
  const parsed = parseIssueForm(issue.body || "");

  // Busca comentários como updates
  const updates = await fetchAllIssueComments(issue.number);

  return {
    id: issue.number,
    title: cleanIncidentTitle(issue.title),
    status: issue.state === "open" ? parsed.severity : "operational",
    state: issue.state,
    services: parsed.services,
    message: parsed.message, // pode ser vazio
    updates,                 // ✅ NOVO: comentários
    timestamp: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
  };
}

async function main() {
  // lê arquivo atual só pra não quebrar se não existir (mas vamos sobrescrever)
  try {
    await fs.readFile(STATUS_PATH, "utf8");
  } catch {
    // ignore
  }

  const baseServices = {};
  for (const s of SUPPORTED_SERVICES) {
    baseServices[s] = "operational";
  }

  const issues = await listAllIssues();

  // filtra issues válidas
  const incidentIssues = issues
    .filter(isTrustedIssue)
    .filter(isIncidentIssue);

  // monta incidentes com comments
  const incidents = (await Promise.all(incidentIssues.map(toIncidentRecord)))
    // mantém incidentes com pelo menos 1 serviço válido
    .filter((i) => i.services.length > 0);

  const openIncidents = incidents.filter((i) => i.state === "open");
  const services = computeOverallServices(baseServices, openIncidents);

  const next = {
    last_updated: new Date().toISOString(),
    services,
    incidents: openIncidents.slice(0, 50), // só abertos
  };

  await fs.writeFile(STATUS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
}

await main();