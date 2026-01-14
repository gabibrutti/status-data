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
  const statusPath = './status.json';
  let statusData = {
    last_updated: new Date().toISOString(),
    services: {},
    incidents: []
  };

  if (fs.existsSync(statusPath)) {
    try {
      statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch (e) {
      console.log('Criando novo status.json');
    }
  }

  // Verifica se o script foi rodado por uma Issue ou manualmente
  const issueContext = process.env.ISSUE_CONTEXT;
  if (!issueContext || issueContext === 'null') {
    console.log('Execução manual detectada: Resetando status para Operacional.');
    
    // Reset de segurança: se rodar manual, limpamos incidentes e voltamos serviços para operacional
    statusData.incidents = [];
    ALLOWED_SERVICES.forEach(s => statusData.services[s] = "operational");
    statusData.last_updated = new Date().toISOString();
    
    fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
    return;
  }

  const issue = JSON.parse(issueContext);
  console.log(`Processando Issue #${issue.number}: ${issue.title}`);

  if (!issue.title.toUpperCase().includes('[INCIDENTE]')) {
    console.log('Abortado: Título não contém [INCIDENTE]');
    return;
  }

  statusData.last_updated = new Date().toISOString();
  const body = issue.body || "";
  
  const extractSection = (title) => {
    const regex = new RegExp(`### ${title}\\s*[\\r\\n]+([\\s\\S]*?)(?:\\n###|$)`, 'i');
    const match = body.match(regex);
    return match ? match[1].trim() : "";
  };

  const severityRaw = extractSection('Severidade');
  const servicesRaw = extractSection('Serviços afetados');
  const severity = severityRaw.toLowerCase() || 'investigating';
  const rawServices = servicesRaw.split(/[\n,]+/).map(s => s.trim()).filter(s => s !== "");

  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
  const isClosed = issue.state === 'closed';

  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);
  
  if (isClosed || issue.state === 'deleted') {
    if (incidentIndex > -1) {
      statusData.incidents.splice(incidentIndex, 1);
    }
  } else {
    const incidentObj = {
      id: issue.number,
      title: issue.title.replace(/\[INCIDENTE\]/i, '').trim(),
      status: severity,
      severity: severity,
      services: affectedServices,
      last_update: new Date().toISOString(),
      url: issue.html_url
    };

    if (incidentIndex > -1) {
      statusData.incidents[incidentIndex] = incidentObj;
    } else {
      statusData.incidents.unshift(incidentObj);
    }
  }

  // Atualiza serviços baseado nos incidentes que sobraram
  ALLOWED_SERVICES.forEach(service => {
    const activeForService = statusData.incidents.find(inc => inc.services.includes(service));
    statusData.services[service] = activeForService ? activeForService.severity : "operational";
  });

  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('Sucesso: status.json atualizado.');
}

run().catch(err => {
  console.error('ERRO CRÍTICO:', err);
  process.exit(1);
});
