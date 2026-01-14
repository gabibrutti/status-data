import fs from 'fs';

// Lista exata dos serviços permitidos
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
  // Captura os dados da issue enviados pelo Workflow
  const issue = JSON.parse(process.env.ISSUE_CONTEXT);

  // 1. Filtro: Só processa se o título começar com [INCIDENTE]
  if (!issue.title.startsWith('[INCIDENTE]')) {
    console.log('Ignorado: Não é um incidente.');
    return;
  }

  const statusPath = './status.json';
  let statusData = { services: {}, incidents: [] };

  // Carrega o status.json atual se ele existir
  if (fs.existsSync(statusPath)) {
    statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  }

  // 2. Parsing do Corpo (Severidade e Serviços Afetados)
  const body = issue.body || "";
  const severityMatch = body.match(/### Severidade\s*\n\s*(.+)/i);
  const servicesMatch = body.match(/### Serviços afetados\s*\n\s*(.+)/i);

  const severity = severityMatch ? severityMatch[1].trim().toLowerCase() : 'investigating';
  const rawServices = servicesMatch ? servicesMatch[1].split(',').map(s => s.trim()) : [];

  // Filtra para garantir que só usaremos serviços da lista oficial
  const affectedServices = rawServices.filter(s => ALLOWED_SERVICES.includes(s));
  const isClosed = issue.state === 'closed';

  // 3. Atualiza o Status dos Serviços no JSON
  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      // Se a issue foi fechada, volta para operational, senão usa a severidade
      statusData.services[service] = isClosed ? "operational" : severity;
    } else if (!statusData.services[service]) {
      // Garante que serviços novos comecem como operational
      statusData.services[service] = "operational";
    }
  });

  // 4. Salva o arquivo (resolve o erro da linha 75 que você teve)
  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('Arquivo status.json atualizado com sucesso.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
