import { Router, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// Os schemas do MCP usam zod v4: com os tipos do zod v3 o SDK dispara
// TS2589 e o `tsc` estoura a heap (cada registerTool custa ~5M
// instanciacoes de tipo). z3 fica apenas para o validateRequest, que
// ainda espera ZodSchema do v3.
import { z as z3 } from 'zod';
import * as z from 'zod/v4';
import db from '../config/database';
import { logger } from '../config/logger';
import { API_KEY_GRANTABLE_PERMISSIONS, hasPermission } from '../constants/permissions';
import { AuthenticatedRequest, authenticateJWT, authenticateJwtOrApiKey, requirePermission } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { settingsService } from '../services/SettingsService';
import { workspaceService } from '../services/WorkspaceService';
import { DomainSetupService } from '../services/DomainSetupService';
import { MultiTenantEmailService } from '../services/MultiTenantEmailService';
import { TenantContextService } from '../services/TenantContextService';
import { planLimitsService } from '../services/PlanLimitsService';
import { AiIntegrationService, AI_AGENT_DEFAULT_PERMISSIONS } from '../services/AiIntegrationService';
import { generateApiKey, generateSecretKey, hashApiKey } from '../utils/crypto';
import { resolveInsertedId } from '../utils/insertedId';
import { assertSafeWebhookUrl } from '../utils/urlSecurity';
import { getAccountUserId, getActorUserId, getOrganizationId } from '../utils/accountContext';
import { applyApiKeyMetadataForWrite, deriveApiKeyType, getApiKeySelectColumns, getApiKeyTableCapabilities } from '../utils/apiKeyTable';

const router = Router();
const domainSetupService = new DomainSetupService();

const aiAgentKeySchema = z3.object({
  key_name: z3.string().min(1).max(100),
  description: z3.string().max(300).optional(),
  permissions: z3.array(z3.enum(API_KEY_GRANTABLE_PERMISSIONS)).min(1).optional()
});

const parseEvents = (events: unknown): string[] => {
  if (Array.isArray(events)) {
    return events.filter((event): event is string => typeof event === 'string');
  }

  if (typeof events === 'string') {
    try {
      const parsed = JSON.parse(events);
      return Array.isArray(parsed)
        ? parsed.filter((event): event is string => typeof event === 'string')
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const buildWebhookName = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Webhook';
  }
};

const parsePermissions = (permissions: unknown): string[] => {
  if (Array.isArray(permissions)) {
    return permissions.filter((permission): permission is string => typeof permission === 'string');
  }

  if (typeof permissions === 'string') {
    try {
      const parsed = JSON.parse(permissions);
      return Array.isArray(parsed)
        ? parsed.filter((permission): permission is string => typeof permission === 'string')
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const normalizeApiKey = (apiKey: any) => ({
  id: Number(apiKey.id),
  key_name: apiKey.name,
  description: apiKey.description || null,
  key_type: deriveApiKeyType(apiKey),
  permissions: parsePermissions(apiKey.permissions),
  created_at: apiKey.created_at,
  last_used_at: apiKey.last_used ?? null,
  is_active: Boolean(apiKey.is_active),
  api_key_preview: apiKey.key_preview
});

const resolvePublicOrigin = (req: AuthenticatedRequest) => {
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto']
    : undefined;
  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host']
    : undefined;

  if (forwardedHost) {
    return AiIntegrationService.getPublicOrigin(`${forwardedProto || req.protocol || 'https'}://${forwardedHost}`);
  }

  if (req.get('host')) {
    return AiIntegrationService.getPublicOrigin(`${req.protocol || 'https'}://${req.get('host')}`);
  }

  return AiIntegrationService.getPublicOrigin();
};

const ensureMcpAgentAccess = (req: AuthenticatedRequest) => {
  if (req.apiKey && req.apiKey.key_type !== 'ai_agent') {
    throw createError('Use uma AI Agent Key dedicada para acessar o MCP da UltraZend.', 403);
  }
};

const buildToolResult = (label: string, payload: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: `${label}\n\n${JSON.stringify(payload, null, 2)}`
    }
  ]
});

const createStoredApiKey = async (params: {
  userId: number;
  actorUserId: number;
  name: string;
  description?: string | null;
  keyType?: 'standard' | 'ai_agent';
  permissions: string[];
}) => {
  const existingKey = await db('api_keys')
    .where('user_id', params.userId)
    .where('name', params.name)
    .first();

  if (existingKey) {
    throw createError('Ja existe uma API key com esse nome.', 409);
  }

  const plainKey = generateApiKey(params.keyType === 'ai_agent' ? 'uai' : 're');
  const hashedKey = await hashApiKey(plainKey);

  const insertPayload = await applyApiKeyMetadataForWrite({
    user_id: params.userId,
    name: params.name,
    description: params.description || null,
    key_type: params.keyType || 'standard',
    key_hash: hashedKey,
    key_preview: plainKey.slice(0, 10),
    permissions: JSON.stringify(params.permissions),
    created_at: new Date(),
    updated_at: new Date(),
    is_active: true
  });

  const insertResult = await db('api_keys').insert(insertPayload);

  const keyId = resolveInsertedId(insertResult)
    ?? Number(
      (
        await db('api_keys')
          .select('id')
          .where('user_id', params.userId)
          .where('name', params.name)
          .orderBy('id', 'desc')
          .first()
      )?.id
    );

  if (!keyId) {
    throw createError('Falha ao criar a API key.', 500);
  }

  const storedKey = await db('api_keys')
    .where('id', keyId)
    .first();

  logger.info('AI/API key created from AI integration module', {
    userId: params.userId,
    actorUserId: params.actorUserId,
    keyId,
    keyType: params.keyType || 'standard',
    permissions: params.permissions
  });

  return {
    key: plainKey,
    api_key: normalizeApiKey(storedKey)
  };
};

const fetchAccountSummary = async (req: AuthenticatedRequest) => {
  const accountUserId = getAccountUserId(req);
  const apiKeyCapabilities = await getApiKeyTableCapabilities();
  const aiAgentKeyCountQuery = db('api_keys')
    .where('user_id', accountUserId)
    .where('is_active', true)
    .modify((query) => {
      if (apiKeyCapabilities.hasKeyType) {
        query.where('key_type', 'ai_agent');
        return;
      }

      query.where('key_preview', 'like', 'uai_%');
    })
    .count('* as total')
    .first();

  const [domainsTotal, domainsVerified, webhooksTotal, aiAgentKeysTotal] = await Promise.all([
    db('domains').where('user_id', accountUserId).count('* as total').first(),
    db('domains').where('user_id', accountUserId).where('is_verified', true).count('* as total').first(),
    db('webhooks').where('user_id', accountUserId).count('* as total').first(),
    aiAgentKeyCountQuery
  ]);

  return {
    accountName: req.user?.name || 'Conta UltraZend',
    accountEmail: req.user?.email || '',
    organizationId: req.user?.organization_id || null,
    organizationName: req.user?.organization_name || null,
    domainsTotal: Number((domainsTotal as any)?.total || 0),
    domainsVerified: Number((domainsVerified as any)?.total || 0),
    webhooksTotal: Number((webhooksTotal as any)?.total || 0),
    aiAgentKeysTotal: Number((aiAgentKeysTotal as any)?.total || 0)
  };
};

const registerMcpResources = async (server: McpServer, req: AuthenticatedRequest, origin: string) => {
  const accountSummary = await fetchAccountSummary(req);

  server.registerResource(
    'quickstart',
    'ultrazend://docs/quickstart',
    { title: 'Quickstart', description: 'Passo a passo minimo', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'ultrazend://docs/quickstart',
          mimeType: 'text/markdown',
          text: AiIntegrationService.buildQuickstartMarkdown(origin)
        }
      ]
    })
  );

  server.registerResource(
    'domain-authentication',
    'ultrazend://docs/domain-authentication',
    { title: 'Autenticacao de dominio', description: 'SPF, DKIM, DMARC e MAIL FROM', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'ultrazend://docs/domain-authentication',
          mimeType: 'text/markdown',
          text: AiIntegrationService.buildDomainGuideMarkdown(origin)
        }
      ]
    })
  );

  server.registerResource(
    'webhooks',
    'ultrazend://docs/webhooks',
    { title: 'Webhooks', description: 'Guia de assinatura e retries', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'ultrazend://docs/webhooks',
          mimeType: 'text/markdown',
          text: AiIntegrationService.buildWebhookGuideMarkdown()
        }
      ]
    })
  );

  server.registerResource(
    'mcp-guide',
    'ultrazend://docs/mcp',
    { title: 'Servidor MCP', description: 'Como conectar IDEs com IA', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'ultrazend://docs/mcp',
          mimeType: 'text/markdown',
          text: AiIntegrationService.buildMcpGuideMarkdown(origin)
        }
      ]
    })
  );

  server.registerResource(
    'account-summary',
    'ultrazend://account/summary',
    { title: 'Resumo da conta', description: 'Estado atual da conta autenticada', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'ultrazend://account/summary',
          mimeType: 'text/markdown',
          text: AiIntegrationService.buildAccountSummaryMarkdown(accountSummary)
        }
      ]
    })
  );
};

const registerMcpPrompts = (server: McpServer, origin: string) => {
  server.registerPrompt(
    'integrate_ultrazend_transactional_email',
    {
      title: 'Integrar envio transacional',
      description: 'Prompt padrao para onboarding completo',
      argsSchema: {
        framework: z.string().optional(),
        language: z.string().optional()
      }
    },
    async ({ framework, language }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              AiIntegrationService.buildPromptTemplate(origin),
              framework ? `Framework alvo: ${framework}` : null,
              language ? `Linguagem alvo: ${language}` : null
            ].filter(Boolean).join('\n')
          }
        }
      ]
    })
  );

  server.registerPrompt(
    'configure_ultrazend_domain_authentication',
    {
      title: 'Configurar dominio',
      description: 'Prompt focado no setup DNS do dominio do cliente',
      argsSchema: {
        domain: z.string().min(3)
      }
    },
    async ({ domain }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Configure o dominio ${domain} para envio transacional na UltraZend.`,
              'Use as tools do MCP para iniciar e verificar o setup.',
              'Explique exatamente quais registros DNS publicar e nao altere registros do site principal.'
            ].join('\n')
          }
        }
      ]
    })
  );

  server.registerPrompt(
    'implement_ultrazend_webhooks',
    {
      title: 'Implementar webhooks',
      description: 'Prompt focado no consumidor de webhook da aplicacao',
      argsSchema: {
        framework: z.string().optional()
      }
    },
    async ({ framework }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Implemente um consumidor robusto de webhooks da UltraZend.',
              framework ? `Framework alvo: ${framework}` : null,
              'Valide X-Webhook-Signature com HMAC SHA256, preserve o corpo bruto e trate retries com idempotencia.'
            ].filter(Boolean).join('\n')
          }
        }
      ]
    })
  );
};

const registerMcpTools = (server: McpServer, req: AuthenticatedRequest) => {
  const accountUserId = getAccountUserId(req);

  server.registerTool(
    'account_overview',
    {
      title: 'Resumo da conta',
      description: 'Panorama da conta autenticada'
    },
    async () => {
      const summary = await fetchAccountSummary(req);
      return buildToolResult('Resumo da conta autenticada', summary);
    }
  );

  if (hasPermission(req.user?.permissions, 'workspace:read')) {
    server.registerTool(
      'workspace_context',
      {
        title: 'Contexto do workspace',
        description: 'Retorna workspace ativo, conta dona e memberships disponiveis'
      },
      async () => {
        const workspace = await workspaceService.getContext(req.user!.id, req.user?.organization_id);
        return buildToolResult('Workspace ativo da credencial autenticada', workspace);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'domain:read')) {
    server.registerTool(
      'domains_list',
      {
        title: 'Listar dominios',
        description: 'Lista dominios e status de verificacao'
      },
      async () => {
        const domains = await domainSetupService.getUserDomainsStatus(accountUserId);
        return buildToolResult('Dominios da conta', domains);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'domain:write')) {
    server.registerTool(
      'domain_setup',
      {
        title: 'Configurar dominio',
        description: 'Inicia o setup de autenticacao DNS de um dominio',
        inputSchema: {
          domain: z.string().min(3).max(253)
        }
      },
      async ({ domain }) => {
        const result = await domainSetupService.initiateDomainSetup(accountUserId, domain.toLowerCase().trim());
        return buildToolResult('Setup de dominio iniciado', result);
      }
    );

    server.registerTool(
      'domain_verify',
      {
        title: 'Verificar dominio',
        description: 'Executa a verificacao DNS do dominio configurado',
        inputSchema: {
          domain_id: z.number().int().positive()
        }
      },
      async ({ domain_id }) => {
        const result = await domainSetupService.verifyDomainSetup(accountUserId, Number(domain_id));
        return buildToolResult('Resultado da verificacao DNS', result);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'webhook:read')) {
    server.registerTool(
      'webhooks_list',
      {
        title: 'Listar webhooks',
        description: 'Lista os webhooks configurados na conta'
      },
      async () => {
        const webhooks = await db('webhooks')
          .where('user_id', accountUserId)
          .orderBy('created_at', 'desc');

        const normalized = webhooks.map((webhook: any) => ({
          id: Number(webhook.id),
          name: webhook.name || buildWebhookName(webhook.url),
          webhook_url: webhook.url,
          events: parseEvents(webhook.events),
          is_active: Boolean(webhook.is_active),
          created_at: webhook.created_at,
          updated_at: webhook.updated_at
        }));

        return buildToolResult('Webhooks configurados', normalized);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'webhook:write')) {
    server.registerTool(
      'webhook_create',
      {
        title: 'Criar webhook',
        description: 'Cria um novo endpoint de webhook HTTPS',
        inputSchema: {
          webhook_url: z.string().url(),
          name: z.string().min(1).max(120).optional(),
          secret: z.string().min(16).max(64).optional(),
          events: z.array(z.enum([
            'email.sent',
            'email.delivered',
            'email.opened',
            'email.clicked',
            'email.failed'
          ])).min(1)
        }
      },
      async ({ webhook_url, name, secret, events }) => {
        await assertSafeWebhookUrl(webhook_url);
        await planLimitsService.assertResourceLimit(accountUserId, 'webhooks');

        const insertResult = await db('webhooks').insert({
          url: webhook_url,
          name: name || buildWebhookName(webhook_url),
          events: JSON.stringify(events),
          secret: secret || generateSecretKey(),
          is_active: true,
          user_id: accountUserId,
          created_at: new Date(),
          updated_at: new Date()
        });

        const webhookId = resolveInsertedId(insertResult);
        const webhook = webhookId
          ? await db('webhooks').where('id', webhookId).first()
          : null;

        return buildToolResult('Webhook criado com sucesso', {
          id: webhook?.id || webhookId,
          name: webhook?.name || name || buildWebhookName(webhook_url),
          webhook_url,
          events,
          secret: webhook?.secret || secret
        });
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'settings:read')) {
    server.registerTool(
      'settings_get',
      {
        title: 'Ler configuracoes',
        description: 'Consulta as configuracoes efetivas da conta'
      },
      async () => {
        const workspace = await workspaceService.getContext(req.user!.id, req.user?.organization_id);
        const settings = await settingsService.getEffectiveSettings(req.user!.id, workspace);
        return buildToolResult('Configuracoes efetivas da conta', settings);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'settings:write')) {
    server.registerTool(
      'settings_update',
      {
        title: 'Atualizar configuracoes',
        description: 'Atualiza configuracoes com um payload parcial',
        inputSchema: {
          payload: z.record(z.string(), z.any())
        }
      },
      async ({ payload }) => {
        const workspace = await workspaceService.getContext(req.user!.id, req.user?.organization_id);
        const settings = await settingsService.updateEffectiveSettings(req.user!.id, workspace, payload);
        return buildToolResult('Configuracoes atualizadas', settings);
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'api_key:read')) {
    server.registerTool(
      'api_keys_list',
      {
        title: 'Listar API keys',
        description: 'Lista todas as API keys da conta'
      },
      async () => {
        const selectColumns = await getApiKeySelectColumns();
        const apiKeys = await db('api_keys')
          .select(selectColumns)
          .where('user_id', accountUserId)
          .orderBy('created_at', 'desc');

        return buildToolResult('API keys da conta', apiKeys.map(normalizeApiKey));
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'api_key:write')) {
    server.registerTool(
      'api_key_create',
      {
        title: 'Criar API key',
        description: 'Cria uma API key padrao para a aplicacao do cliente',
        inputSchema: {
          key_name: z.string().min(1).max(100),
          description: z.string().max(300).optional(),
          permissions: z.array(z.enum(API_KEY_GRANTABLE_PERMISSIONS)).min(1)
        }
      },
      async ({ key_name, description, permissions }) => {
        const result = await createStoredApiKey({
          userId: accountUserId,
          actorUserId: getActorUserId(req),
          name: key_name,
          description: description || null,
          keyType: 'standard',
          permissions
        });

        return buildToolResult('API key criada com sucesso', {
          ...result.api_key,
          key: result.key,
          warning: 'A chave completa so e exibida nesta resposta.'
        });
      }
    );
  }

  if (hasPermission(req.user?.permissions, 'email:send')) {
    server.registerTool(
      'send_test_email',
      {
        title: 'Enviar email de teste',
        description: 'Executa um envio transacional de teste',
        inputSchema: {
          from: z.string().email(),
          to: z.string().email(),
          subject: z.string().min(1).max(255),
          html: z.string().optional(),
          text: z.string().optional(),
          template_id: z.number().int().positive().optional(),
          variables: z.record(z.string(), z.any()).optional()
        }
      },
      async ({ from, to, subject, html, text, template_id, variables }) => {
        const tenantValidation = await TenantContextService.getInstance().validateTenantOperation(accountUserId, {
          operation: 'send_email',
          resource: from.split('@')[1].toLowerCase(),
          metadata: { to }
        });
        if (!tenantValidation.allowed) {
          return buildToolResult('Envio bloqueado pela politica da conta', {
            success: false,
            error: tenantValidation.reason || 'Tenant policy blocked email sending',
            code: 'TENANT_POLICY_BLOCKED',
            metadata: tenantValidation.metadata
          });
        }

        const emailService = new MultiTenantEmailService();
        const result = await emailService.sendEmail(
          {
            from,
            to,
            subject,
            html,
            text,
            template_id: template_id ? String(template_id) : undefined,
            variables
          },
          {
            id: accountUserId,
            email: req.user!.email,
            name: req.user!.name,
            tenant_id: getOrganizationId(req) || accountUserId,
            api_key_id: req.apiKey?.id || null
          }
        );

        return buildToolResult('Resultado do envio de teste', result);
      }
    );
  }
};

const createMcpServer = async (req: AuthenticatedRequest, origin: string) => {
  const server = new McpServer(
    {
      name: 'ultrazend-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  await registerMcpResources(server, req, origin);
  registerMcpPrompts(server, origin);
  registerMcpTools(server, req);
  return server;
};

router.get('/overview',
  authenticateJWT,
  requirePermission('api_key:read'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accountUserId = getAccountUserId(req);
    const origin = resolvePublicOrigin(req);
    const selectColumns = await getApiKeySelectColumns();
    const apiKeyCapabilities = await getApiKeyTableCapabilities();
    const [summary, aiAgentKeys] = await Promise.all([
      fetchAccountSummary(req),
      db('api_keys')
        .select(selectColumns)
        .where('user_id', accountUserId)
        .modify((query) => {
          if (apiKeyCapabilities.hasKeyType) {
            query.where('key_type', 'ai_agent');
            return;
          }

          query.where('key_preview', 'like', 'uai_%');
        })
        .orderBy('created_at', 'desc')
    ]);

    res.json({
      overview: AiIntegrationService.buildOverviewPayload(origin, req.user?.permissions, undefined, {
        organizationId: req.user?.organization_id || null,
        organizationName: req.user?.organization_name || null
      }),
      account_summary: summary,
      agent_keys: aiAgentKeys.map(normalizeApiKey)
    });
  })
);

router.get('/agent-keys',
  authenticateJWT,
  requirePermission('api_key:read'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accountUserId = getAccountUserId(req);
    const selectColumns = await getApiKeySelectColumns();
    const apiKeyCapabilities = await getApiKeyTableCapabilities();
    const agentKeys = await db('api_keys')
      .select(selectColumns)
      .where('user_id', accountUserId)
      .modify((query) => {
        if (apiKeyCapabilities.hasKeyType) {
          query.where('key_type', 'ai_agent');
          return;
        }

        query.where('key_preview', 'like', 'uai_%');
      })
      .orderBy('created_at', 'desc');

    res.json({
      agent_keys: agentKeys.map(normalizeApiKey)
    });
  })
);

router.post('/agent-keys',
  authenticateJWT,
  requirePermission('api_key:write'),
  validateRequest({ body: aiAgentKeySchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accountUserId = getAccountUserId(req);
    const actorUserId = getActorUserId(req);
    const origin = resolvePublicOrigin(req);
    const permissions = req.body.permissions?.length
      ? req.body.permissions
      : [...AI_AGENT_DEFAULT_PERMISSIONS];

    const created = await createStoredApiKey({
      userId: accountUserId,
      actorUserId,
      name: req.body.key_name,
      description: req.body.description || 'Chave dedicada para agentes em Cursor, VS Code e IDEs com IA.',
      keyType: 'ai_agent',
      permissions
    });

    res.status(201).json({
      message: 'AI Agent Key criada com sucesso.',
      api_key: created.api_key,
      key: created.key,
      onboarding: AiIntegrationService.buildOverviewPayload(origin, permissions, created.key, {
        organizationId: req.user?.organization_id || null,
        organizationName: req.user?.organization_name || null
      }),
      warning: 'Guarde a chave com seguranca. Ela nao sera exibida novamente. Use esta credencial apenas no MCP; a aplicacao cliente deve usar uma API key padrao re_...'
    });
  })
);

router.post('/mcp',
  authenticateJwtOrApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    let server: McpServer | null = null;
    let transport: StreamableHTTPServerTransport | null = null;

    try {
      ensureMcpAgentAccess(req);

      if (!req.user) {
        throw createError('Autenticacao obrigatoria para o MCP da UltraZend.', 401);
      }

      const origin = resolvePublicOrigin(req);
      server = await createMcpServer(req, origin);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      res.on('close', () => {
        void transport?.close();
        void server?.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Failed to process UltraZend MCP request', {
        error: error instanceof Error ? error.message : String(error),
        userId: req.user?.id,
        apiKeyId: req.apiKey?.id
      });

      if (!res.headersSent) {
        const statusCode = (error as any)?.statusCode || 500;
        res.status(statusCode).json({
          jsonrpc: '2.0',
          error: {
            code: statusCode === 403 ? -32001 : -32603,
            message: error instanceof Error ? error.message : 'Internal server error'
          },
          id: null
        });
      }
    }
  }
);

const methodNotAllowed = (_req: AuthenticatedRequest, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.'
    },
    id: null
  });
};

router.get('/mcp', authenticateJwtOrApiKey, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  ensureMcpAgentAccess(req);
  methodNotAllowed(req, res);
}));

router.delete('/mcp', authenticateJwtOrApiKey, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  ensureMcpAgentAccess(req);
  methodNotAllowed(req, res);
}));

export default router;
