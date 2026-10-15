export type ApiPermissionId =
  | 'email:send'
  | 'email:read'
  | 'email:manage'
  | 'domain:read'
  | 'domain:write'
  | 'domain:manage'
  | 'template:read'
  | 'template:write'
  | 'template:manage'
  | 'analytics:read'
  | 'webhook:read'
  | 'webhook:write'
  | 'api_key:read'
  | 'api_key:write'
  | 'settings:read'
  | 'settings:write'
  | 'workspace:read'

export interface ApiPermissionDefinition {
  id: ApiPermissionId
  label: string
  description: string
  category: 'envio' | 'leitura' | 'conteudo' | 'observabilidade' | 'automacao' | 'configuracao' | 'seguranca'
}

export interface ApiKeyPreset {
  id: string
  label: string
  description: string
  permissions: ApiPermissionId[]
  recommendation?: string
}

export interface WebhookEventDefinition {
  value: string
  label: string
  description: string
  availability: 'live' | 'planned'
  deliveryMeaning: string
}

export const apiPermissionCatalog: ApiPermissionDefinition[] = [
  { id: 'email:send', label: 'Enviar emails', description: 'Autoriza chamadas para envio transacional.', category: 'envio' },
  { id: 'email:read', label: 'Ler emails', description: 'Permite listar mensagens e abrir detalhes.', category: 'leitura' },
  { id: 'email:manage', label: 'Gerenciar emails', description: 'Agrupa leitura e envio para fluxos completos de entrega.', category: 'envio' },
  { id: 'domain:read', label: 'Ler dominios', description: 'Consulta status de dominios autenticados.', category: 'leitura' },
  { id: 'domain:write', label: 'Editar dominios', description: 'Cria, verifica e remove dominios da conta.', category: 'configuracao' },
  { id: 'domain:manage', label: 'Gerenciar dominios', description: 'Agrupa leitura e escrita para autenticacao DNS completa.', category: 'configuracao' },
  { id: 'template:read', label: 'Ler templates', description: 'Consulta templates salvos da conta.', category: 'conteudo' },
  { id: 'template:write', label: 'Gerenciar templates', description: 'Cria, atualiza e remove templates.', category: 'conteudo' },
  { id: 'template:manage', label: 'Controle total de templates', description: 'Agrupa leitura e escrita para a biblioteca privada.', category: 'conteudo' },
  { id: 'analytics:read', label: 'Ler analytics', description: 'Acessa metricas e eventos de engajamento.', category: 'observabilidade' },
  { id: 'webhook:read', label: 'Ler webhooks', description: 'Visualiza endpoints, logs e estatisticas.', category: 'automacao' },
  { id: 'webhook:write', label: 'Gerenciar webhooks', description: 'Cria, atualiza, testa e desativa endpoints.', category: 'automacao' },
  { id: 'api_key:read', label: 'Ler API keys', description: 'Lista chaves tecnicas da conta e seus previews.', category: 'seguranca' },
  { id: 'api_key:write', label: 'Gerenciar API keys', description: 'Cria, regenera, ativa ou revoga credenciais tecnicas.', category: 'seguranca' },
  { id: 'settings:read', label: 'Ler configuracoes', description: 'Consulta defaults de envio, webhook, SMTP e branding.', category: 'configuracao' },
  { id: 'settings:write', label: 'Gerenciar configuracoes', description: 'Atualiza defaults operacionais da conta.', category: 'configuracao' },
  { id: 'workspace:read', label: 'Ler workspace', description: 'Consulta contexto organizacional ativo da conta.', category: 'leitura' },
]

export const apiKeyPresets: ApiKeyPreset[] = [
  {
    id: 'transactional-sender',
    label: 'Enviar emails',
    description: 'Recomendado para a maioria dos sistemas.',
    permissions: ['email:send', 'email:read', 'domain:read', 'analytics:read']
  },
  {
    id: 'content-ops',
    label: 'Templates',
    description: 'Criar e editar templates.',
    permissions: ['email:read', 'template:read', 'template:write', 'analytics:read']
  },
  {
    id: 'full-integration',
    label: 'Acesso completo',
    description: 'Envio, templates e webhooks.',
    permissions: ['email:send', 'email:read', 'template:read', 'template:write', 'domain:read', 'analytics:read', 'webhook:read', 'webhook:write']
  }
]

export const webhookEventCatalog: WebhookEventDefinition[] = [
  {
    value: 'email.sent',
    label: 'Email aceito na API',
    description: 'Disparado quando a requisicao de envio e aceita e a mensagem entra na fila interna.',
    availability: 'live',
    deliveryMeaning: 'Mensagem validada e registrada pela VeloMail.'
  },
  {
    value: 'email.delivered',
    label: 'Aceito pelo servidor destinatario',
    description: 'Disparado quando o servidor remoto aceita a mensagem via SMTP.',
    availability: 'live',
    deliveryMeaning: 'Aceito pelo servidor, nao necessariamente na inbox.'
  },
  {
    value: 'email.opened',
    label: 'Abertura registrada',
    description: 'Disparado quando o pixel de tracking e carregado no email HTML.',
    availability: 'live',
    deliveryMeaning: 'Depende de imagens remotas habilitadas pelo cliente de email.'
  },
  {
    value: 'email.clicked',
    label: 'Clique registrado',
    description: 'Disparado quando um link rastreado da mensagem e acessado.',
    availability: 'live',
    deliveryMeaning: 'Inclui a URL original no payload.'
  },
  {
    value: 'email.failed',
    label: 'Falha imediata de entrega',
    description: 'Disparado quando o pipeline de envio falha antes da aceitacao SMTP.',
    availability: 'live',
    deliveryMeaning: 'Usado para tratar erro operacional ou rejeicao imediata.'
  },
  {
    value: 'email.bounced',
    label: 'Bounce assicrono',
    description: 'Reservado para quando o fluxo de DSN e bounce mailbox estiver ativo.',
    availability: 'planned',
    deliveryMeaning: 'Em breve.'
  },
  {
    value: 'email.unsubscribed',
    label: 'Descadastro',
    description: 'Reservado para fluxos de preferencia e unsubscribe gerenciado.',
    availability: 'planned',
    deliveryMeaning: 'Em breve.'
  },
  {
    value: 'email.spam_complaint',
    label: 'Reclamacao de spam',
    description: 'Reservado para provedores ou caixas que suportam feedback loop.',
    availability: 'planned',
    deliveryMeaning: 'Em breve.'
  }
]

export const apiEndpointCatalog = [
  { method: 'POST', path: '/api/emails/send', description: 'Envia um email transacional com autenticacao por API key.' },
  { method: 'GET', path: '/api/emails/:id', description: 'Recupera detalhes de uma mensagem enviada.' },
  { method: 'GET', path: '/api/emails/:id/analytics', description: 'Lista eventos de entrega, abertura e clique da mensagem.' },
  { method: 'GET', path: '/api/templates', description: 'Lista templates privados da conta autenticada.' },
  { method: 'POST', path: '/api/templates', description: 'Cria um template privado editável para envio transacional.' },
  { method: 'GET', path: '/api/shared-templates/public', description: 'Consulta biblioteca compartilhada com filtros e paginação.' },
  { method: 'GET', path: '/api/keys', description: 'Lista as API keys da conta autenticada via painel.' },
  { method: 'GET', path: '/api/webhooks', description: 'Lista endpoints e metricas de entrega dos webhooks.' },
]

export const getPublicSiteOrigin = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return 'https://www.velomail.com.br'
}

export const getApiBaseForDocs = () => `${getPublicSiteOrigin()}/api`
export const getSwaggerDocsUrl = () => `${getPublicSiteOrigin()}/api-docs`

export const buildSendEmailCurlExample = (apiKey = 're_xxxxxxxxxxxxxxxxx') => `curl -X POST '${getApiBaseForDocs()}/emails/send' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: ${apiKey}' \\
  -d '{
    "from": "contato@seu-dominio.com",
    "to": "voce@exemplo.com",
    "subject": "Olá!",
    "html": "<p>Meu primeiro email pela VeloMail</p>"
  }'`

export const buildSendEmailFetchExample = () => `const velomailApiKey = process.env.VELOMAIL_API_KEY! // chave padrao re_..., nao use a AI Agent Key

const response = await fetch('${getApiBaseForDocs()}/emails/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': velomailApiKey,
  },
  body: JSON.stringify({
    from: 'no-reply@seu-dominio.com',
    to: 'cliente@empresa.com',
    subject: 'Pedido confirmado',
    template_id: 42,
    variables: {
      customer_name: 'Ana',
      order_id: '1048'
    },
    html: '<h1>Pedido confirmado</h1><p>Seu pedido #1048 foi recebido.</p>',
    text: 'Pedido confirmado\\n\\nSeu pedido #1048 foi recebido.',
    tracking_enabled: true,
  }),
})

const data = await response.json()`

export const buildWebhookPayloadExample = (event = 'email.delivered') => `{
  "event": "${event}",
  "timestamp": "2026-03-04T14:30:00.000Z",
  "webhook_id": "18",
  "tenant_id": 7,
  "data": {
    "email_id": 152,
    "message_id": "<uz-01JQ-example@velomail.com.br>",
    "tracking_id": "trk_01JQEXAMPLE",
    "template_id": 42,
    "template_data": {
      "customer_name": "Ana",
      "order_id": "1048"
    },
    "from": "no-reply@seu-dominio.com",
    "to": "cliente@empresa.com",
    "subject": "Pedido confirmado",
    "status": "delivered",
    "accepted_by_server": true,
    "source": "smtp_acceptance",
    "domain": "seu-dominio.com",
    "occurred_at": "2026-03-04T14:30:00.000Z"
  }
}`

export const buildWebhookVerificationExample = () => `import crypto from 'node:crypto'

export function verifyUltraZendSignature(rawBody: string, signature: string, secret: string) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  return signature === \`sha256=\${expected}\`
}`
