import { hasPermission } from '../constants/permissions';
import { Env } from '../utils/env';

export const AI_AGENT_DEFAULT_PERMISSIONS = [
  'email:send',
  'email:read',
  'domain:manage',
  'template:manage',
  'analytics:read',
  'webhook:write',
  'api_key:write',
  'settings:write',
  'workspace:read'
] as const;

type PermissionList = string[] | undefined | null;

type WorkspaceScope = {
  organizationId?: number | null;
  organizationName?: string | null;
};

export interface AiToolDescriptor {
  name: string;
  title: string;
  description: string;
  required_permissions: string[];
}

export interface AiResourceDescriptor {
  uri: string;
  title: string;
  description: string;
}

export interface AiPromptDescriptor {
  name: string;
  title: string;
  description: string;
}

const TOOL_CATALOG: AiToolDescriptor[] = [
  {
    name: 'account_overview',
    title: 'Resumo da conta',
    description: 'Retorna um panorama da conta, dominio, webhooks e chaves ativas.',
    required_permissions: []
  },
  {
    name: 'workspace_context',
    title: 'Contexto do workspace',
    description: 'Retorna organizacao ativa, conta dona e memberships disponiveis.',
    required_permissions: ['workspace:read']
  },
  {
    name: 'domains_list',
    title: 'Listar dominios',
    description: 'Lista dominios, status de verificacao e nivel de prontidao.',
    required_permissions: ['domain:read']
  },
  {
    name: 'domain_setup',
    title: 'Configurar dominio',
    description: 'Inicia a autenticacao DNS de um novo dominio do cliente.',
    required_permissions: ['domain:write']
  },
  {
    name: 'domain_verify',
    title: 'Verificar dominio',
    description: 'Executa a verificacao DNS do dominio e retorna pendencias reais.',
    required_permissions: ['domain:write']
  },
  {
    name: 'webhooks_list',
    title: 'Listar webhooks',
    description: 'Lista endpoints de webhook, eventos e saude de entrega.',
    required_permissions: ['webhook:read']
  },
  {
    name: 'webhook_create',
    title: 'Criar webhook',
    description: 'Cria um endpoint de webhook HTTPS com eventos selecionados.',
    required_permissions: ['webhook:write']
  },
  {
    name: 'settings_get',
    title: 'Ler configuracoes',
    description: 'Consulta defaults de envio, tracking, SMTP e webhook padrao.',
    required_permissions: ['settings:read']
  },
  {
    name: 'settings_update',
    title: 'Atualizar configuracoes',
    description: 'Atualiza configuracoes de conta por payload parcial.',
    required_permissions: ['settings:write']
  },
  {
    name: 'api_keys_list',
    title: 'Listar API keys',
    description: 'Lista chaves ativas da conta com preview e ultimo uso.',
    required_permissions: ['api_key:read']
  },
  {
    name: 'api_key_create',
    title: 'Criar API key',
    description: 'Cria uma nova API key padrao para uso da aplicacao do cliente.',
    required_permissions: ['api_key:write']
  },
  {
    name: 'send_test_email',
    title: 'Enviar email de teste',
    description: 'Executa um envio transacional de teste para validar a integracao.',
    required_permissions: ['email:send']
  }
];

const RESOURCE_CATALOG: AiResourceDescriptor[] = [
  {
    uri: 'ultrazend://docs/quickstart',
    title: 'Quickstart',
    description: 'Passo a passo minimo para colocar a integracao em producao.'
  },
  {
    uri: 'ultrazend://docs/domain-authentication',
    title: 'Autenticacao de dominio',
    description: 'Guia de SPF, DKIM, DMARC e MAIL FROM gerenciado.'
  },
  {
    uri: 'ultrazend://docs/webhooks',
    title: 'Webhooks',
    description: 'Guia de assinatura, retries, idempotencia e payloads.'
  },
  {
    uri: 'ultrazend://docs/mcp',
    title: 'Servidor MCP',
    description: 'Como conectar Cursor e VS Code ao servidor MCP remoto da VeloMail.'
  },
  {
    uri: 'ultrazend://account/summary',
    title: 'Resumo da conta',
    description: 'Estado atual da conta autenticada para o agente.'
  }
];

const PROMPT_CATALOG: AiPromptDescriptor[] = [
  {
    name: 'integrate_ultrazend_transactional_email',
    title: 'Integrar envio transacional',
    description: 'Prompt base para o agente implementar envio, dominio e webhook.'
  },
  {
    name: 'configure_ultrazend_domain_authentication',
    title: 'Configurar dominio',
    description: 'Prompt focado em autenticacao DNS e verificacao.'
  },
  {
    name: 'implement_ultrazend_webhooks',
    title: 'Implementar webhooks',
    description: 'Prompt focado em consumidor robusto com validacao de assinatura.'
  }
];

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export class AiIntegrationService {
  static getPublicOrigin(explicitOrigin?: string): string {
    if (explicitOrigin) {
      return trimTrailingSlash(explicitOrigin);
    }

    const frontendUrl = Env.get('FRONTEND_URL', Env.get('APP_URL', 'https://www.velomail.com.br'));
    return trimTrailingSlash(frontendUrl);
  }

  static getRecommendedPermissions(): string[] {
    return [...AI_AGENT_DEFAULT_PERMISSIONS];
  }

  static getVisibleTools(permissions?: PermissionList): AiToolDescriptor[] {
    return TOOL_CATALOG.filter((tool) =>
      tool.required_permissions.length === 0
      || tool.required_permissions.every((permission) => hasPermission(permissions, permission))
    );
  }

  static getResourceCatalog(): AiResourceDescriptor[] {
    return RESOURCE_CATALOG;
  }

  static getPromptCatalog(): AiPromptDescriptor[] {
    return PROMPT_CATALOG;
  }

  static buildCursorConfig(origin: string, apiKeyValue?: string, scope?: WorkspaceScope): string {
    const headers: Record<string, string> = {
      'x-api-key': apiKeyValue || 'YOUR_VELOMAIL_AI_AGENT_KEY'
    };

    if (scope?.organizationId) {
      headers['x-organization-id'] = String(scope.organizationId);
    }

    return JSON.stringify({
      mcpServers: {
        VeloMail: {
          url: `${this.getPublicOrigin(origin)}/api/ai/mcp`,
          headers
        }
      }
    }, null, 2);
  }

  static buildVsCodeConfig(origin: string, apiKeyValue?: string, scope?: WorkspaceScope): string {
    const headers: Record<string, string> = {
      'x-api-key': apiKeyValue || 'YOUR_VELOMAIL_AI_AGENT_KEY'
    };

    if (scope?.organizationId) {
      headers['x-organization-id'] = String(scope.organizationId);
    }

    return JSON.stringify({
      servers: {
        velomail: {
          type: 'http',
          url: `${this.getPublicOrigin(origin)}/api/ai/mcp`,
          headers
        }
      }
    }, null, 2);
  }

  static buildPromptTemplate(origin: string, scope?: WorkspaceScope): string {
    const publicOrigin = this.getPublicOrigin(origin);
    return [
      'Voce e o agente tecnico responsavel por integrar a VeloMail em uma aplicacao real.',
      '',
      'Objetivo:',
      '1. Conectar ao servidor MCP remoto da VeloMail.',
      '2. Consultar a documentacao oficial e o estado real da conta antes de alterar codigo.',
      '3. Garantir dominio autenticado, webhook funcional e primeiro envio transacional de teste.',
      '4. Entregar codigo pronto para producao sem hardcode de segredos.',
      '',
      'Regras de execucao:',
      '- Nunca hardcode API keys, secrets ou emails reais no repositorio.',
      '- Salve segredos apenas em variaveis de ambiente.',
      '- Se o dominio nao estiver autenticado, use as tools do MCP para iniciar e verificar o setup DNS.',
      '- Ao configurar webhooks, implemente validacao HMAC SHA256 do header X-Webhook-Signature.',
      '- Antes do deploy, rode um envio de teste e reporte o que ainda bloqueia producao.',
      '',
      'Contexto VeloMail:',
      `- MCP endpoint: ${publicOrigin}/api/ai/mcp`,
      `- OpenAPI: ${publicOrigin}/api-docs`,
      '- Header de autenticacao do MCP: x-api-key',
      '- Variavel recomendada para a chave: VELOMAIL_AI_AGENT_KEY',
      '- Para chamadas transacionais da aplicacao cliente em /api/emails/send, use uma API key padrao `re_...` em VELOMAIL_API_KEY.',
      scope?.organizationId ? `- Workspace alvo: ${scope.organizationName || 'Workspace ativo'} (#${scope.organizationId}) via header x-organization-id` : null,
      '',
      'Resultado esperado:',
      '- Codigo da integracao implementado;',
      '- Webhook configurado;',
      '- Dominio pronto ou lista objetiva do que falta no DNS;',
      '- Teste de envio executado com resumo tecnico final.'
    ].filter(Boolean).join('\n');
  }

  static buildQuickstartMarkdown(origin: string, scope?: WorkspaceScope): string {
    const publicOrigin = this.getPublicOrigin(origin);
    return [
      '# VeloMail AI Quickstart',
      '',
      '## 1. Gere uma AI Agent Key',
      `Use a pagina ${publicOrigin}/app/ai e copie a chave apenas uma vez.`,
      '',
      '## 2. Conecte sua IDE',
      'Cursor: salve o arquivo em `.cursor/mcp.json`.',
      'VS Code: salve o arquivo em `.vscode/mcp.json`.',
      scope?.organizationId ? `Inclua tambem o header \`x-organization-id: ${scope.organizationId}\` para operar no workspace ${scope.organizationName || 'ativo'}.` : null,
      '',
      '## 3. Inicie o agente',
      'Cole o prompt padrao da VeloMail e peça para o agente implementar a integracao completa.',
      '',
      '## 4. Fluxo esperado',
      '- Ler docs e recursos via MCP.',
      '- Validar dominio, webhooks e settings.',
      '- Criar ou revisar a API key de envio da aplicacao (`re_...`).',
      '- Implementar envio de teste e consumidor de webhook.',
      '',
      '## 5. Boas praticas',
      '- Nao exponha a chave do agente em codigo fonte.',
      '- Nao reutilize a AI Agent Key como VELOMAIL_API_KEY da aplicacao cliente.',
      '- Gere uma chave separada para producao e outra para homologacao.',
      '- Revoke a chave do agente quando o setup terminar.'
    ].filter(Boolean).join('\n');
  }

  static buildDomainGuideMarkdown(origin: string): string {
    const publicOrigin = this.getPublicOrigin(origin);
    return [
      '# Autenticacao de Dominio VeloMail',
      '',
      'Antes de liberar trafego em producao, confirme:',
      '- SPF publicado para o subdominio tecnico gerenciado pela VeloMail;',
      '- DKIM publicado exatamente com a chave entregue no painel;',
      '- DMARC com politica explicita e mailbox de relatorio;',
      '- MAIL FROM tecnico apontando para o hostname gerenciado pela plataforma.',
      '',
      `Painel de dominio: ${publicOrigin}/app/domains`,
      '',
      'Recomendacoes:',
      '- Nao altere os registros do site principal se o dominio do cliente ja hospeda um site.',
      '- Prefira o subdominio tecnico `uz-mail.seu-dominio.com` para SPF e MAIL FROM.',
      '- Use a verificacao do painel ou a tool `domain_verify` antes do primeiro envio.'
    ].join('\n');
  }

  static buildWebhookGuideMarkdown(): string {
    return [
      '# Webhooks VeloMail',
      '',
      'Implementacao minima:',
      '- endpoint HTTPS publico;',
      '- leitura do corpo bruto;',
      '- validacao HMAC SHA256 em `X-Webhook-Signature`;',
      '- idempotencia por `event + data.message_id + timestamp`;',
      '- retries tratados sem duplicidade.',
      '',
      'Eventos ativos hoje:',
      '- email.sent',
      '- email.delivered',
      '- email.opened',
      '- email.clicked',
      '- email.failed',
      '',
      'Regra operacional:',
      '- `email.delivered` significa aceite SMTP do servidor remoto, nao garantia de inbox.'
    ].join('\n');
  }

  static buildMcpGuideMarkdown(origin: string): string {
    const publicOrigin = this.getPublicOrigin(origin);
    return [
      '# Servidor MCP VeloMail',
      '',
      'Endpoint remoto:',
      `${publicOrigin}/api/ai/mcp`,
      '',
      'Autenticacao:',
      '- Header `x-api-key` com uma AI Agent Key ativa.',
      '- Essa chave e exclusiva do MCP e nao substitui a VELOMAIL_API_KEY transacional da aplicacao cliente.',
      '',
      'Capacidades expostas:',
      '- tools para listar/configurar dominios, webhooks, settings, API keys e envio de teste;',
      '- resources com quickstart, docs de dominio, docs de webhook e resumo da conta;',
      '- prompts padrao para onboarding tecnico.',
      '',
      'Clientes recomendados:',
      '- Cursor via `.cursor/mcp.json`',
      '- VS Code via `.vscode/mcp.json`'
    ].join('\n');
  }

  static buildAccountSummaryMarkdown(summary: {
    accountName: string;
    accountEmail: string;
    domainsTotal: number;
    domainsVerified: number;
    webhooksTotal: number;
    aiAgentKeysTotal: number;
    organizationId?: number | null;
    organizationName?: string | null;
  }): string {
    return [
      '# Resumo da conta autenticada',
      '',
      `- Conta: ${summary.accountName} <${summary.accountEmail}>`,
      `- Workspace atual: ${summary.organizationName || 'principal'}${summary.organizationId ? ` (#${summary.organizationId})` : ''}`,
      `- Dominios totais: ${summary.domainsTotal}`,
      `- Dominios verificados: ${summary.domainsVerified}`,
      `- Webhooks configurados: ${summary.webhooksTotal}`,
      `- AI Agent Keys ativas: ${summary.aiAgentKeysTotal}`
    ].join('\n');
  }

  static buildOverviewPayload(origin: string, permissions?: PermissionList, apiKeyValue?: string, scope?: WorkspaceScope) {
    const publicOrigin = this.getPublicOrigin(origin);

    return {
      mcp_endpoint: `${publicOrigin}/api/ai/mcp`,
      docs_url: `${publicOrigin}/api-docs`,
      workspace_scope: {
        organization_id: scope?.organizationId || null,
        organization_name: scope?.organizationName || null
      },
      quickstart_markdown: this.buildQuickstartMarkdown(publicOrigin, scope),
      prompt_template: this.buildPromptTemplate(publicOrigin, scope),
      cursor_mcp_json: this.buildCursorConfig(publicOrigin, undefined, scope),
      vscode_mcp_json: this.buildVsCodeConfig(publicOrigin, undefined, scope),
      cursor_mcp_json_with_key: apiKeyValue ? this.buildCursorConfig(publicOrigin, apiKeyValue, scope) : null,
      vscode_mcp_json_with_key: apiKeyValue ? this.buildVsCodeConfig(publicOrigin, apiKeyValue, scope) : null,
      recommended_permissions: this.getRecommendedPermissions(),
      tools: this.getVisibleTools(permissions),
      resources: this.getResourceCatalog(),
      prompts: this.getPromptCatalog()
    };
  }
}
