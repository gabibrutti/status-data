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

  console.log(`Severidade detectada: ${severity}`);
  console.log(`Serviços brutos na issue: ${rawServices}`);

  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
  console.log(`Serviços validados e vinculados: ${affectedServices}`);

  const isClosed = issue.state === 'closed';

  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      statusData.services[service] = isClosed ? "operational" : severity;
    } else {
      statusData.services[service] = "operational";
    }
  });

  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);
  
  if (issue.state === 'deleted') {
    if (incidentIndex > -1) {
      statusData.incidents.splice(incidentIndex, 1);
    }
  } else {
    const incidentObj = {
      id: issue.number,
      title: issue.title.replace(/\[INCIDENTE\]/i, '').trim(),
      status: isClosed ? 'resolved' : severity,
      severity: severity,
      services: affectedServices,
      last_update: new Date().toISOString(),
      url: issue.html_url
    };

    if (incidentIndex > -1) {
      statusData.incidents[incidentIndex] = incidentObj;
    } else if (!isClosed) {
      statusData.incidents.unshift(incidentObj);
    }
  }

  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('Sucesso: status.json atualizado.');
}

run().catch(err => {
  console.error('ERRO CRÍTICO:', err);
  process.exit(1);
});
