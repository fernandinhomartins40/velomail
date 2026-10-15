import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Activity, CheckCircle, Clock, Code, ExternalLink, Eye, Pause, Play, Plus, RefreshCw, Send, Trash2, Webhook, XCircle } from 'lucide-react'
import { webhookApi } from '@/lib/api'
import { copyToClipboard, formatRelativeTime } from '@/lib/utils'
import { CodeSnippetCard } from '@/components/developer/CodeSnippetCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/ui/page'
import { Textarea } from '@/components/ui/textarea'
import {
  buildWebhookPayloadExample,
  buildWebhookVerificationExample,
  getSwaggerDocsUrl,
  webhookEventCatalog,
} from '@/lib/developerPortal'

const webhookEvents = webhookEventCatalog

type WebhookEvent = typeof webhookEventCatalog[number]['value']

const webhookSchema = z.object({
  webhook_url: z.string().url('URL invalida').refine((url) => url.startsWith('https://'), 'Webhook deve usar HTTPS'),
  events: z.array(z.enum(webhookEvents.map((event) => event.value) as [WebhookEvent, ...WebhookEvent[]])).min(1, 'Selecione pelo menos um evento'),
  secret: z.string().optional().refine((value) => !value || value.length >= 16, 'Secret deve ter pelo menos 16 caracteres'),
})

type WebhookForm = z.infer<typeof webhookSchema>

interface WebhookConfig {
  id: number
  name: string
  webhook_url: string
  events: WebhookEvent[]
  has_secret: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  last_delivery_at?: string
  delivery_success_rate: number
}

interface WebhookLog {
  id: number
  webhook_id: number
  event_type: string
  status: 'success' | 'failed' | 'pending' | 'retry'
  http_status?: number
  request_body: string
  response_body?: string
  response_time_ms?: number
  attempts: number
  next_retry_at?: string
  created_at: string
  error_message?: string
}

const getStatusBadge = (status: WebhookLog['status']) => {
  switch (status) {
    case 'success':
      return <span className="vm-status vm-status-success">Sucesso</span>
    case 'failed':
      return <Badge variant="destructive">Falha</Badge>
    case 'retry':
      return <Badge variant="outline">Retry</Badge>
    default:
      return <Badge variant="outline">Pendente</Badge>
  }
}

const getStatusIcon = (status: WebhookLog['status']) => {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-[hsl(var(--success))]" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />
    case 'retry':
      return <RefreshCw className="h-4 w-4 text-[hsl(var(--warning))]" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

export function Webhooks() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('webhooks')
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookConfig | null>(null)
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null)
  const [latestSecret, setLatestSecret] = useState<{
    secret: string
    webhookName: string
    webhookUrl: string
  } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WebhookConfig | null>(null)
  const [logFilters, setLogFilters] = useState({ status: 'all', event_type: 'all' })

  const form = useForm<WebhookForm>({
    resolver: zodResolver(webhookSchema),
    defaultValues: {
      webhook_url: '',
      events: [],
      secret: '',
    },
  })

  const { data: webhooksResponse, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: webhookApi.getWebhooks,
  })

  const webhookList: WebhookConfig[] = webhooksResponse?.data?.webhooks || []

  const { data: logsResponse } = useQuery({
    queryKey: ['webhook-logs', selectedWebhook?.id, logFilters],
    queryFn: () => webhookApi.getWebhookLogs(String(selectedWebhook?.id), logFilters),
    enabled: Boolean(selectedWebhook),
  })

  const logList: WebhookLog[] = logsResponse?.data?.logs || []

  const createMutation = useMutation({
    mutationFn: (data: WebhookForm) =>
      webhookApi.createWebhook({
        webhook_url: data.webhook_url,
        events: data.events,
        secret: data.secret?.trim() || undefined,
      }),
    onSuccess: (response) => {
      const payload = response.data as {
        webhook?: WebhookConfig
        secret?: string
      }

      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      setIsCreating(false)
      if (payload.webhook) {
        setSelectedWebhook(payload.webhook)
      }
      if (payload.secret) {
        setLatestSecret({
          secret: payload.secret,
          webhookName: payload.webhook?.name || 'Webhook',
          webhookUrl: payload.webhook?.webhook_url || '',
        })
      }
      form.reset()
      toast.success('Webhook criado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao criar webhook')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WebhookForm> & { is_active?: boolean } }) =>
      webhookApi.updateWebhook(
        String(id),
        Object.fromEntries(
          Object.entries({
            webhook_url: data.webhook_url,
            events: data.events,
            secret: data.secret?.trim() || undefined,
            is_active: data.is_active,
          }).filter(([, value]) => value !== undefined)
        )
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook atualizado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao atualizar webhook')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => webhookApi.deleteWebhook(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      setSelectedWebhook(null)
      setDeleteTarget(null)
      toast.success('Webhook removido')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao remover webhook')
    },
  })

  const testMutation = useMutation({
    mutationFn: (id: number) => webhookApi.testWebhook(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      queryClient.invalidateQueries({ queryKey: ['webhook-logs'] })
      toast.success('Webhook de teste enviado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao testar webhook')
    },
  })

  const selectedEvents = form.watch('events') || []

  const docsPayload = useMemo(
    () => buildWebhookPayloadExample(),
    []
  )

  const handleSelectWebhook = (webhook: WebhookConfig) => {
    setSelectedWebhook(webhook)
    setIsCreating(false)
    form.reset({
      webhook_url: webhook.webhook_url,
      events: webhook.events,
      secret: '',
    })
  }

  const handleNewWebhook = () => {
    setSelectedWebhook(null)
    setIsCreating(true)
    form.reset({
      webhook_url: '',
      events: [],
      secret: '',
    })
  }

  const handleSubmit = (data: WebhookForm) => {
    if (selectedWebhook && !isCreating) {
      updateMutation.mutate({ id: selectedWebhook.id, data })
      return
    }

    createMutation.mutate(data)
  }

  const handleToggleWebhook = (webhook: WebhookConfig) => {
    updateMutation.mutate({
      id: webhook.id,
      data: {
        webhook_url: webhook.webhook_url,
        events: webhook.events,
        is_active: !webhook.is_active,
      },
    })
  }

  const handleEventToggle = (eventValue: WebhookEvent) => {
    const eventDefinition = webhookEvents.find((event) => event.value === eventValue)
    if (eventDefinition?.availability === 'planned') {
      return
    }

    const currentEvents = form.getValues('events') || []
    form.setValue(
      'events',
      currentEvents.includes(eventValue)
        ? currentEvents.filter((event) => event !== eventValue)
        : [...currentEvents, eventValue]
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Receba um aviso no seu sistema quando um email for entregue, aberto ou falhar."
        actions={
          <Button onClick={handleNewWebhook}>
            <Plus className="mr-2 h-4 w-4" />
            Novo webhook
          </Button>
        }
      />

      {latestSecret ? (
        <Card className="border-[hsl(var(--success)/.3)] bg-[hsl(var(--success)/.08)]">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-foreground">Chave secreta do webhook</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Copie agora. Ela não aparece de novo.
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {latestSecret.webhookName}
                  {latestSecret.webhookUrl ? ` - ${latestSecret.webhookUrl}` : ''}
                </div>
                <div className="mt-3 rounded-lg border bg-white p-3">
                  <code className="block overflow-x-auto text-sm font-mono">{latestSecret.secret}</code>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(latestSecret.secret).then(() => toast.success('Secret copiado'))}
                  >
                    Copiar secret
                  </Button>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={() => setLatestSecret(null)}>
                Fechar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="webhooks">
            <Webhook className="mr-2 h-4 w-4" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Activity className="mr-2 h-4 w-4" />
            Logs
          </TabsTrigger>
          <TabsTrigger value="docs">
            <Code className="mr-2 h-4 w-4" />
            Como validar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Seus endpoints</CardTitle>
                <CardDescription>{webhookList.length} webhook(s) configurado(s)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="rounded-lg border p-3 animate-pulse">
                      <div className="mb-2 h-4 rounded bg-muted" />
                      <div className="h-3 w-24 rounded bg-muted" />
                    </div>
                  ))
                ) : webhookList.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Webhook className="mx-auto mb-3 h-10 w-10" />
                    Nenhum webhook configurado.
                  </div>
                ) : (
                  webhookList.map((webhook) => (
                    <div
                      key={webhook.id}
                      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                        selectedWebhook?.id === webhook.id ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
                      }`}
                      onClick={() => handleSelectWebhook(webhook)}
                    >
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{webhook.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{webhook.webhook_url}</div>
                        </div>
                        <Badge variant={webhook.is_active ? 'default' : 'outline'}>
                          {webhook.is_active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {webhook.events.length} evento(s) • {webhook.delivery_success_rate.toFixed(1)}% sucesso
                      </div>
                      {webhook.last_delivery_at && (
                        <div className="text-xs text-muted-foreground">Ultima entrega {formatRelativeTime(webhook.last_delivery_at)}</div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>{isCreating ? 'Novo webhook' : selectedWebhook ? 'Editar webhook' : 'Selecione um webhook'}</CardTitle>
                    <CardDescription>
                      {isCreating || selectedWebhook
                        ? 'Defina a URL, os eventos e o segredo de assinatura.'
                        : 'Escolha um webhook existente ou crie um novo endpoint.'}
                    </CardDescription>
                  </div>
                  {selectedWebhook && !isCreating && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => testMutation.mutate(selectedWebhook.id)}>
                        <Send className="mr-2 h-4 w-4" />
                        Testar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleToggleWebhook(selectedWebhook)}>
                        {selectedWebhook.is_active ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                        {selectedWebhook.is_active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(selectedWebhook)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {selectedWebhook || isCreating ? (
                  <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
                    <div>
                      <Label htmlFor="webhook_url">URL do webhook</Label>
                      <Input id="webhook_url" placeholder="https://api.seusistema.com/webhooks" {...form.register('webhook_url')} />
                      {form.formState.errors.webhook_url && (
                        <p className="mt-1 text-sm text-destructive">{form.formState.errors.webhook_url.message}</p>
                      )}
                    </div>

                    <div>
                      <Label>Eventos</Label>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {webhookEvents.map((event) => (
                          <button
                            key={event.value}
                            type="button"
                            disabled={event.availability === 'planned'}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              selectedEvents.includes(event.value) ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
                            } ${event.availability === 'planned' ? 'cursor-not-allowed opacity-60' : ''}`}
                            onClick={() => handleEventToggle(event.value)}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="font-medium">{event.label}</div>
                              <Badge variant={event.availability === 'live' ? 'default' : 'outline'}>
                                {event.availability === 'live' ? 'Live' : 'Em breve'}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{event.value}</div>
                          </button>
                        ))}
                      </div>
                      {form.formState.errors.events && (
                        <p className="mt-1 text-sm text-destructive">{form.formState.errors.events.message}</p>
                      )}
                      {selectedWebhook?.events.some((eventValue) => webhookEvents.find((event) => event.value === eventValue)?.availability === 'planned') && (
                        <div className="mt-3 rounded-lg border border-[hsl(var(--warning)/.3)] bg-[hsl(var(--warning)/.12)] p-3 text-sm text-foreground">
                          Este endpoint possui eventos planejados salvos. Eles continuam visiveis, mas so os eventos
                          marcados como <span className="font-medium">Live</span> serao emitidos pelo fluxo atual.
                        </div>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="secret">Secret</Label>
                      <Input id="secret" type="password" placeholder="Opcional. Usado para assinatura HMAC." {...form.register('secret')} />
                      {form.formState.errors.secret && (
                        <p className="mt-1 text-sm text-destructive">{form.formState.errors.secret.message}</p>
                      )}
                      {selectedWebhook?.has_secret && !isCreating && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Um secret ja existe para este webhook. Deixe em branco para manter o valor atual.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                        {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : isCreating ? 'Criar webhook' : 'Salvar alteracoes'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsCreating(false)
                          setSelectedWebhook(null)
                          form.reset()
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="py-14 text-center text-muted-foreground">
                    <Webhook className="mx-auto mb-4 h-12 w-12" />
                    Selecione um webhook para editar ou criar um novo endpoint.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 md:flex-row">
              <div className="flex-1">
                <Label>Webhook</Label>
                <Select
                  value={selectedWebhook?.id ? String(selectedWebhook.id) : ''}
                  onValueChange={(value) => {
                    const webhook = webhookList.find((item) => String(item.id) === value) || null
                    setSelectedWebhook(webhook)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um webhook" />
                  </SelectTrigger>
                  <SelectContent>
                    {webhookList.map((webhook) => (
                      <SelectItem key={webhook.id} value={String(webhook.id)}>
                        {webhook.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full md:w-48">
                <Label>Status</Label>
                <Select value={logFilters.status} onValueChange={(value) => setLogFilters((current) => ({ ...current, status: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="success">Sucesso</SelectItem>
                    <SelectItem value="failed">Falha</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full md:w-56">
                <Label>Evento</Label>
                <Select value={logFilters.event_type} onValueChange={(value) => setLogFilters((current) => ({ ...current, event_type: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {webhookEvents.map((event) => (
                      <SelectItem key={event.value} value={event.value}>
                        {event.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="webhook.test">Teste interno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Historico de entrega</CardTitle>
                  <CardDescription>Execucoes reais dos webhooks configurados.</CardDescription>
                </div>
                <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['webhook-logs'] })}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedWebhook ? (
                <div className="py-10 text-center text-muted-foreground">Selecione um webhook para ver os logs.</div>
              ) : logList.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">Nenhum log encontrado para os filtros atuais.</div>
              ) : (
                logList.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    className="w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40"
                    onClick={() => setSelectedLog(log)}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(log.status)}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{log.event_type}</span>
                            {getStatusBadge(log.status)}
                            {log.http_status && <Badge variant="outline">{log.http_status}</Badge>}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatRelativeTime(log.created_at)} • {log.attempts} tentativa(s)
                            {log.response_time_ms ? ` • ${log.response_time_ms}ms` : ''}
                          </div>
                        </div>
                      </div>
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </div>
                    {log.error_message && (
                      <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 p-2 text-sm text-destructive">{log.error_message}</div>
                    )}
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-6 space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Checklist de implementacao</CardTitle>
                <CardDescription>O minimo para um consumidor de webhook robusto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="rounded-xl border bg-muted/45 p-4">
                  <div className="font-medium text-foreground">HTTPS + resposta rapida</div>
                  <p className="mt-2 leading-6">Responda 2xx rapidamente e delegue processamento pesado para fila interna.</p>
                </div>
                <div className="rounded-xl border bg-muted/45 p-4">
                  <div className="font-medium text-foreground">Assinatura HMAC</div>
                  <p className="mt-2 leading-6">Valide `X-Webhook-Signature` com o corpo bruto usando o secret do endpoint.</p>
                </div>
                <div className="rounded-xl border bg-muted/45 p-4">
                  <div className="font-medium text-foreground">Idempotencia</div>
                  <p className="mt-2 leading-6">Use `webhook_id + event + data.message_id + timestamp` para evitar duplicidade em retries.</p>
                </div>
                <div className="rounded-xl border bg-muted/45 p-4">
                  <div className="font-medium text-foreground">Teste interno</div>
                  <p className="mt-2 leading-6">`webhook.test` aparece nos logs e nao depende da lista de eventos selecionados.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/app/developers">Portal de integração</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={getSwaggerDocsUrl()} target="_blank" rel="noreferrer">
                      OpenAPI
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <CodeSnippetCard
                title="Payload de exemplo"
                description="Formato padrão entregue pelos eventos live da VeloMail."
                code={docsPayload}
                language="json"
              />
              <CodeSnippetCard
                title="Validacao de assinatura"
                description="Exemplo Node para validar o header X-Webhook-Signature."
                code={buildWebhookVerificationExample()}
                language="ts"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Remover webhook"
        description={deleteTarget ? `Remover o endpoint ${deleteTarget.name}? Esta acao nao pode ser desfeita.` : ''}
        variant="danger"
      />

      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalhes do log</DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Evento</Label>
                  <div className="text-sm">{selectedLog.event_type}</div>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(selectedLog.status)}
                    <span className="text-sm">{selectedLog.status}</span>
                  </div>
                </div>
                <div>
                  <Label>HTTP status</Label>
                  <div className="text-sm">{selectedLog.http_status || 'N/A'}</div>
                </div>
                <div>
                  <Label>Tempo de resposta</Label>
                  <div className="text-sm">{selectedLog.response_time_ms ? `${selectedLog.response_time_ms}ms` : 'N/A'}</div>
                </div>
              </div>

              <div>
                <Label>Request body</Label>
                <Textarea readOnly value={selectedLog.request_body} className="mt-1 h-40 font-mono text-xs" />
              </div>

              {selectedLog.response_body && (
                <div>
                  <Label>Response body</Label>
                  <Textarea readOnly value={selectedLog.response_body} className="mt-1 h-40 font-mono text-xs" />
                </div>
              )}

              {selectedLog.error_message && (
                <div>
                  <Label>Erro</Label>
                  <div className="mt-1 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">{selectedLog.error_message}</div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
