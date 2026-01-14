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
  const action = process.env.EVENT_ACTION;

  // 1. Validar se é um Incidente pelo título
  if (!issue.title.startsWith('[INCIDENTE]')) {
    console.log('Issue não é um incidente. Ignorando.');
    return;
  }

  const statusPath = './status.json';
  let statusData = { services: {}, incidents: [] };

  if (fs.existsSync(statusPath)) {
    statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  }

  // 2. Parsear o corpo da Issue (Severidade e Serviços)
  const body = issue.body || "";
  const severityMatch = body.match(/### Severidade\s*\n\s*(.+)/i);
  const servicesMatch = body.match(/### Serviços afetados\s*\n\s*(.+)/i);

  const severity = severityMatch ? severityMatch[1].trim().toLowerCase() : 'investigating';
  const rawServices = servicesMatch ? servicesMatch[1].split(',').map(s => s.trim()) : [];

  // Filtrar apenas serviços permitidos
  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));

  // 3. Atualizar o Status Global dos Serviços
  // Primeiro, resetamos os serviços afetados para 'operational' se a issue for fechada
  // Ou definimos a severidade se estiver aberta.
  
  const isClosed = issue.state === 'closed';

  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      statusData.services[service] = isClosed ? "operational" : severity;
    } else if (!statusData.services[service]) {
      statusData.services[service] = "operational";
    }
  });

  // 4. Gerenciar a lista de incidentes (opcional, para histórico)
  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);
  const incidentObj = {
    id: issue.number,
    title: issue.title,
    status: isClosed ? 'resolved' : severity,
    services: affectedServices,
    last_update: new Date().toISOString()
  };

  if (incidentIndex > -1) {
    statusData.incidents[incidentIndex] = incidentObj;
  } else {
    statusData.incidents.push(incidentObj);
  }

  // Limpar serviços que não estão na lista permitida (segurança)
  Object.keys(statusData.services).forEach(s => {
    if (!ALLOWED_SERVICES.includes(s)) delete statusData.services[s];
  });

  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('status.json atualizado com sucesso.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
