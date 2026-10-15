import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Copy, History, Pencil, Plus, Power, Send, Trash2, Webhook } from 'lucide-react'
import { webhookApi } from '@/lib/api'
import { cn, copyToClipboard, formatRelativeTime } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, RowActions } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page'
import { webhookEventCatalog } from '@/lib/developerPortal'

type WebhookEvent = typeof webhookEventCatalog[number]['value']

const liveEvents = webhookEventCatalog.filter((event) => event.availability === 'live')

interface WebhookConfig {
  id: number
  name: string
  webhook_url: string
  events: WebhookEvent[]
  is_active: boolean
  last_delivery_at?: string
  delivery_success_rate: number
}

interface WebhookLog {
  id: number
  event_type: string
  status: 'success' | 'failed' | 'pending' | 'retry'
  http_status?: number
  created_at: string
  error_message?: string
}

const logTone: Record<WebhookLog['status'], { label: string; tone: string }> = {
  success: { label: 'Entregue', tone: 'vm-status-success' },
  failed: { label: 'Falhou', tone: 'vm-status-danger' },
  retry: { label: 'Tentando de novo', tone: 'vm-status-warning' },
  pending: { label: 'Na fila', tone: 'vm-status-neutral' },
}

export function Webhooks() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<WebhookConfig | null>(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>(liveEvents.map((event) => event.value))
  const [latestSecret, setLatestSecret] = useState<string | null>(null)
  const [logsTarget, setLogsTarget] = useState<WebhookConfig | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebhookConfig | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: webhookApi.getWebhooks })
  const webhooks: WebhookConfig[] = data?.data?.webhooks || []

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['webhook-logs', logsTarget?.id],
    queryFn: () => webhookApi.getWebhookLogs(String(logsTarget?.id)),
    enabled: Boolean(logsTarget),
  })
  const logs: WebhookLog[] = logsData?.data?.logs || []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    queryClient.invalidateQueries({ queryKey: ['account-usage'] })
  }

  const onError = (fallback: string) => (error: any) => {
    toast.error(error.response?.data?.message || error.response?.data?.error || fallback)
  }

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? webhookApi.updateWebhook(String(editing.id), { webhook_url: url.trim(), events })
      : webhookApi.createWebhook({ webhook_url: url.trim(), events }),
    onSuccess: (response) => {
      refresh()
      setFormOpen(false)
      if (!editing && response.data?.secret) {
        setLatestSecret(response.data.secret)
      } else {
        toast.success('Webhook salvo')
      }
    },
    onError: onError('Não foi possível salvar o webhook'),
  })

  const toggleMutation = useMutation({
    mutationFn: (webhook: WebhookConfig) =>
      webhookApi.updateWebhook(String(webhook.id), { webhook_url: webhook.webhook_url, events: webhook.events, is_active: !webhook.is_active }),
    onSuccess: refresh,
    onError: onError('Não foi possível atualizar o webhook'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => webhookApi.deleteWebhook(String(id)),
    onSuccess: () => {
      refresh()
      setDeleteTarget(null)
      toast.success('Webhook excluído')
    },
    onError: onError('Não foi possível excluir o webhook'),
  })

  const testMutation = useMutation({
    mutationFn: (id: number) => webhookApi.testWebhook(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-logs'] })
      toast.success('Teste enviado. Veja em "Entregas".')
    },
    onError: onError('Não foi possível enviar o teste'),
  })

  const openForm = (webhook: WebhookConfig | null) => {
    setEditing(webhook)
    setUrl(webhook?.webhook_url || '')
    setEvents(webhook?.events || liveEvents.map((event) => event.value))
    setFormOpen(true)
  }

  const toggleEvent = (value: WebhookEvent) => {
    setEvents((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^https:\/\/.+/.test(url.trim())) {
      toast.error('Use um endereço que comece com https://')
      return
    }
    if (events.length === 0) {
      toast.error('Escolha pelo menos um evento')
      return
    }
    saveMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Avisos automáticos para o seu sistema quando um email é entregue, aberto ou falha."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo webhook
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="h-32 animate-pulse bg-muted/40" />
        ) : webhooks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Webhook className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Nenhum webhook ainda.</p>
            <Button onClick={() => openForm(null)}>Criar webhook</Button>
          </div>
        ) : (
          <ul className="divide-y">
            {webhooks.map((webhook) => (
              <li key={webhook.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{webhook.webhook_url}</div>
                  <div className="text-xs text-muted-foreground">
                    {webhook.events.length} {webhook.events.length === 1 ? 'evento' : 'eventos'}
                    {webhook.last_delivery_at ? ` · último aviso ${formatRelativeTime(webhook.last_delivery_at)}` : ''}
                  </div>
                </div>
                <span className={cn('vm-status shrink-0', webhook.is_active ? 'vm-status-success' : 'vm-status-neutral')}>
                  {webhook.is_active ? 'Ativo' : 'Pausado'}
                </span>
                <RowActions>
                  <DropdownMenuItem onSelect={() => openForm(webhook)}>
                    <Pencil className="h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => testMutation.mutate(webhook.id)}>
                    <Send className="h-4 w-4" />
                    Enviar teste
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLogsTarget(webhook)}>
                    <History className="h-4 w-4" />
                    Entregas
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toggleMutation.mutate(webhook)}>
                    <Power className="h-4 w-4" />
                    {webhook.is_active ? 'Pausar' : 'Ativar'}
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => setDeleteTarget(webhook)}>
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-sm text-muted-foreground">
        Para confirmar que o aviso veio da VeloMail, veja{' '}
        <Link to="/app/developers" className="text-primary hover:underline">como validar a assinatura</Link>.
      </p>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar webhook' : 'Novo webhook'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Endereço do seu sistema</Label>
              <Input
                id="webhook-url"
                placeholder="https://seusite.com/webhooks/velomail"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Avisar quando</Label>
              <div className="space-y-1.5">
                {liveEvents.map((event) => (
                  <label key={event.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={events.includes(event.value)} onChange={() => toggleEvent(event.value)} />
                    {event.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(latestSecret)} onOpenChange={(open) => !open && setLatestSecret(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Webhook criado</DialogTitle>
            <DialogDescription>
              Guarde esta chave secreta no seu sistema para validar os avisos. Ela não aparece de novo.
            </DialogDescription>
          </DialogHeader>
          {latestSecret && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm">{latestSecret}</code>
              <Button size="sm" onClick={() => copyToClipboard(latestSecret).then(() => toast.success('Chave copiada'))}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(logsTarget)} onOpenChange={(open) => !open && setLogsTarget(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Entregas</DialogTitle>
            <DialogDescription className="truncate">{logsTarget?.webhook_url}</DialogDescription>
          </DialogHeader>
          {logsLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum aviso enviado ainda.</p>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{log.event_type}</div>
                    {log.error_message && <div className="truncate text-xs text-destructive">{log.error_message}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={cn('vm-status', logTone[log.status]?.tone)}>{logTone[log.status]?.label || log.status}</span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(log.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Excluir webhook"
        description="Seu sistema deixa de receber os avisos deste endereço."
        variant="danger"
      />
    </div>
  )
}
