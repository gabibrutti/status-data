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
  // CORREÇÃO: Verifica se o contexto da Issue existe antes de tentar processar
  if (!process.env.ISSUE_CONTEXT || process.env.ISSUE_CONTEXT === 'null') {
    console.log('Aviso: Nenhum contexto de Issue encontrado (possível execução manual).');
    return;
  }

  const issue = JSON.parse(process.env.ISSUE_CONTEXT);

  // CORREÇÃO: Garante que o objeto issue e o número existam (evita o erro da linha 17)
  if (!issue || !issue.number) {
    console.log('Erro: Dados da Issue inválidos no contexto.');
    return;
  }

  console.log(`Processando Issue #${issue.number}: ${issue.title}`);

  // Ignora issues que não são incidentes
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

  // Carrega o arquivo atual se existir
  if (fs.existsSync(statusPath)) {
    try {
      statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch (e) {
      console.log('Erro ao ler status.json, criando um novo.');
    }
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

  // Atualiza o estado individual dos serviços
  ALLOWED_SERVICES.forEach(service => {
    if (affectedServices.includes(service)) {
      statusData.services[service] = isClosed ? "operational" : severity;
    } else if (!statusData.services[service]) {
      statusData.services[service] = "operational";
    }
  });

  const incidentIndex = statusData.incidents.findIndex(i => i.id === issue.number);
  
  // LÓGICA DE LIMPEZA: Se a issue foi fechada ou deletada, removemos do array de incidentes
  // Isso garante que o banner de "Incidente em andamento" suma do site.
  if (issue.state === 'deleted' || isClosed) {
    if (incidentIndex > -1) {
      statusData.incidents.splice(incidentIndex, 1);
      console.log(`Incidente #${issue.number} removido (Resolvido/Fechado).`);
    }
  } else {
    // Adiciona ou atualiza incidente ativo
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

  // Validação final: Se não houver mais incidentes, todos os serviços DEVEM ser operacionais
  if (statusData.incidents.length === 0) {
    ALLOWED_SERVICES.forEach(s => statusData.services[s] = "operational");
  }

  fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  console.log('Sucesso: status.json atualizado com segurança.');
}

run().catch(err => {
  console.error('ERRO CRÍTICO NO SCRIPT:', err);
  process.exit(1);
});
