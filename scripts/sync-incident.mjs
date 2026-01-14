import fs from 'fs';

const ALLOWED_SERVICES = [
    "Interconexão entre Data Centers (SP1 e SP2)",
    "Datacenter SP2",
    "Datacenter SP1",
    "ACS (Apache Cloud Stack)",
    "vCloud",
    "Central Telefônica",
    "Freshservice (painel de chamados)",
    "Under Control (Painel administrativo)",
    "VPN - Gerência console servidores físico Under"
  ];

async function run() {
    const issue = JSON.parse(process.env.ISSUE_CONTEXT);
    console.log(`Processando Issue #${issue.number}: ${issue.title}`);

  // Verifica se o título contém [INCIDENTE] em qualquer lugar (mais flexível)
  if (!issue.title.toUpperCase().includes('[INCIDENTE]')) {
        console.log('Abortado: Título não contém [INCIDENTE]');
        return;
  }

  const statusPath = './status.json';
    let statusData = {
          last_updated: new Date().toISOString(),
          services: {},
          incidents: []
    };

  if (fs.existsSync(statusPath)) {
        statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  }

  // 1. Forçar atualização da data global
  statusData.last_updated = new Date().toISOString();

  // 2. Parsing Robusto do corpo da issue
  const body = issue.body || "";

  // Regex para capturar o valor após os cabeçalhos do template (### Título)
  const extractSection = (title) => {
        const regex = new RegExp(`### ${title}\\s*[\\r\\n]+([\\s\\S]*?)(?:\\n###|$)`, 'i');
        const match = body.match(regex);
        return match ? match[1].trim() : "";
  };

  const severityRaw = extractSection('Severidade');
    const servicesRaw = extractSection('Serviços afetados');

  const severity = severityRaw.toLowerCase() || 'investigating';

  // Divide por quebras de linha ou vírgulas e limpa espaços
  const rawServices = servicesRaw.split(/[\n,]+/).map(s => s.trim()).filter(s => s !== "");

  console.log(`Severidade detectada: ${severity}`);
    console.log(`Serviços brutos na issue: ${rawServices}`);

  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
    console.log(`Serviços validados e vinculados: ${affectedServices}`);

  const isClosed = issue.state === 'closed';

  // 3. Atualizar Status dos Serviços
  // Primeiro, resetamos os serviços afetados por esta issue se ela estiver sendo fechada
  // Ou atualizamos se estiver aberta.

  ALLOWED_SERVICES.forEach(service => {
        if (affectedServices.includes(service)) {
                statusData.services[service] = isClosed ? "operational" : severity;
        } else if (!statusData.services[service]) {
                statusData.services[service] = "operational";
        }
  });

  // 4. Sincronizar lista de incidentes
  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);

  if (issue.state === 'deleted') {
        if (incidentIndex > -1) {
                statusData.incidents.splice(incidentIndex, 1);
        }
  } else {
        const incident
