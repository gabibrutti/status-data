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

  // 1. Filtro por Título
  if (!issue.title.startsWith('[INCIDENTE]')) {
    console.log('Ignorado: Não é um incidente.');
    return;
  }

  const statusPath = './status.json';
  let statusData = { services: {}, incidents: [] };

  if (fs.existsSync(statusPath)) {
    statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  }

  // 2. Parsing do Corpo (Severidade e Serviços Afetados)
  const body = issue.body || "";
  const severityMatch = body.match(/### Severidade\s*\n\s*(.+)/i);
  const servicesMatch = body.match(/### Serviços afetados\s*\n\s*(.+)/i);

  const severity = severityMatch ? severityMatch[1].trim().toLowerCase() : 'investigating';
  const rawServices = servicesMatch ? servicesMatch[1].split(',').map(s => s.trim()) : [];

  // Filtrar apenas serviços da sua lista oficial
  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
  const isClosed = issue.state === 'closed';

  // 3. Atualizar Status dos Serviços no JSON
  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      statusData.services[service] = isClosed ? "operational" : severity;
    } else if (!statusData.services[service]) {
      statusData.services[service] = "operational";
    }
  });

  // 4. Gravação do Arquivo (A antiga linha 75 do erro)
  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('status.json atualizado com sucesso.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
