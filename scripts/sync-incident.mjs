import fs from "node:fs/promises";
import path from "node:path";

const STATUS_PATH = path.resolve("status.json");

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

if (!token) {
  throw new Error("Missing GITHUB_TOKEN");
}
if (!repo) {
  throw new Error("Missing GITHUB_REPOSITORY");
}

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
  const re = new RegExp(`###\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|$)`, "i");
  const m = body.match(re);
  return (m?.[1] ?? "").trim();
}

function parseIssueForm(body) {
  const severityRaw = extractSection(body, "Severidade").split("\n")[0].trim();
  const servicesRaw = extractSection(body, "Serviços afetados");
  const description = extractSection(body, "Descrição do incidente");
  const update = extractSection(body, "Atualização (opcional)");

  const services = servicesRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*]\s+/, ""));

  const severity = ["degraded", "partial", "major", "maintenance"].includes(severityRaw)
    ? severityRaw
    : "degraded";

  const message = [description, update].filter(Boolean).join("\n\n");

  return { severity, services, message };
}

async function githubRequest(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  return await res.json();
}

async function listAllIssues() {
  // Get up to 100 most recent issues (enough for a simple status page)
  const url = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&sort=created&direction=desc`;
  const issues = await githubRequest(url);
  return issues.filter((i) => !i.pull_request);
}

function isTrustedIssue(issue) {
  const assoc = (issue?.author_association || "").toUpperCase();
  return assoc === "OWNER" || assoc === "MEMBER" || assoc === "COLLABORATOR";
}

function computeOverallServices(baseServices, openIncidents) {
  const next = {};
  for (const s of Object.keys(baseServices)) next[s] = "operational";

  for (const inc of openIncidents) {
    const sev = inc.status;
    for (const s of inc.services) {
      if (!next[s]) next[s] = "operational";
      if ((priority[sev] ?? 0) > (priority[next[s]] ?? 0)) {
        next[s] = sev;
      }
    }
  }

  return next;
}

function toIncidentRecord(issue) {
  const parsed = parseIssueForm(issue.body || "");

  return {
    id: issue.number,
    title: issue.title,
    status: issue.state === "open" ? parsed.severity : parsed.severity,
    state: issue.state,
    services: parsed.services,
    message: parsed.message,
    timestamp: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
  };
}

async function main() {
  let current = { services: {}, incidents: [] };
  try {
    const raw = await fs.readFile(STATUS_PATH, "utf8");
    current = JSON.parse(raw);
  } catch {
    // ignore
  }

  const baseServices = current.services || {};

  const issues = await listAllIssues();
  const incidents = issues
    .filter(isTrustedIssue)
    .map(toIncidentRecord)
    .filter((i) => i.services.length > 0 && i.message.length > 0);

  const openIncidents = incidents.filter((i) => i.state === "open");
  const services = computeOverallServices(baseServices, openIncidents);

  const next = {
    services,
    incidents: incidents.slice(0, 50),
  };

  await fs.writeFile(STATUS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
}

await main();
