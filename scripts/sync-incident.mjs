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

  if (!issue.title.startsWith('[INCIDENTE]')) {
    console.log('Abortado: Título não começa com [INCIDENTE]');
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

  // 1. Forçar atualização da data global para o commit acontecer
  statusData.last_updated = new Date().toISOString();

  // 2. Parsing Robusto (ignora linhas em branco e espaços)
  const body = issue.body || "";
  
  // Regex melhorada para pegar o texto mesmo com espaços ou quebras de linha extras
  const severityMatch = body.match(/### Severidade\s*[\r\n]+([\s\S]*?)(?:\n###|$)/i);
  const servicesMatch = body.match(/### Serviços afetados\s*[\r\n]+([\s\S]*?)(?:\n###|$)/i);

  const severity = severityMatch ? severityMatch[1].trim().toLowerCase() : 'investigating';
  const rawServicesText = servicesMatch ? servicesMatch[1].trim() : "";
  const rawServices = rawServicesText.split(/,|\n/).map(s => s.trim()).filter(s => s !== "");

  console.log(`Severidade detectada: ${severity}`);
  console.log(`Serviços brutos na issue: ${rawServices}`);

  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
  console.log(`Serviços validados e vinculados: ${affectedServices}`);

  const isClosed = issue.state === 'closed';

  // 3. Atualizar Status
  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      statusData.services[service] = isClosed ? "operational" : severity;
    } else if (!statusData.services[service]) {
      statusData.services[service] = "operational";
    }
  });

  // 4. Sincronizar lista de incidentes ativos
  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);
  const incidentObj = {
    id: issue.number,
    title: issue.title.replace('[INCIDENTE]', '').trim(),
    status: isClosed ? 'resolved' : severity,
    severity: severity,
    services: affectedServices,
    last_update: new Date().toISOString()
  };

  if (incidentIndex > -1) {
    if (issue.state === 'deleted') {
      statusData.incidents.splice(incidentIndex, 1);
    } else {
      statusData.incidents[incidentIndex] = incidentObj;
    }
  } else if (!isClosed) {
    statusData.incidents.unshift(incidentObj);
  }

  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('Sucesso: status.json atualizado.');
}

run().catch(err => {
  console.error('ERRO CRÍTICO:', err);
  process.exit(1);
});
