import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Power, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiKeyApi } from '@/lib/api'
import { CodeSnippetCard } from '@/components/developer/CodeSnippetCard'
import { AiSetupDialog } from '@/components/ai/AiSetupDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, RowActions } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page'
import { copyToClipboard, formatRelativeTime } from '@/lib/utils'
import { apiKeyPresets, apiPermissionCatalog, buildSendEmailCurlExample } from '@/lib/developerPortal'

interface ApiKey {
  id: number
  key_name: string
  key_type?: 'standard' | 'ai_agent'
  permissions: string[]
  created_at: string
  last_used_at: string | null
  is_active: boolean
  api_key_preview: string
}

interface KeySectionProps {
  icon: typeof Send
  title: string
  description: string
  action: React.ReactNode
  keys: ApiKey[]
  emptyText: string
  onToggle: (key: ApiKey) => void
  onRegenerate: (key: ApiKey) => void
  onDelete: (key: ApiKey) => void
}

function KeySection({ icon: Icon, title, description, action, keys, emptyText, onToggle, onRegenerate, onDelete }: KeySectionProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="shrink-0">{action}</div>
        </div>

        {keys.length === 0 ? (
          <p className="border-t px-5 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y border-t">
            {keys.map((apiKey) => (
              <li key={apiKey.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{apiKey.key_name}</span>
                    {!apiKey.is_active && <Badge variant="secondary">Desativada</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{apiKey.api_key_preview}••••</span>
                    {' · '}
                    {apiKey.last_used_at ? `usada ${formatRelativeTime(apiKey.last_used_at)}` : 'nunca usada'}
                  </div>
                </div>
                <RowActions>
                  <DropdownMenuItem onSelect={() => onToggle(apiKey)}>
                    <Power className="h-4 w-4" />
                    {apiKey.is_active ? 'Desativar' : 'Ativar'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onRegenerate(apiKey)}>
                    <RotateCcw className="h-4 w-4" />
                    Gerar nova chave
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => onDelete(apiKey)}>
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ApiKeys() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [permissions, setPermissions] = useState<string[]>([...apiKeyPresets[0].permissions])
  const [latestKey, setLatestKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<ApiKey | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: apiKeyApi.getApiKeys,
  })

  const keys: ApiKey[] = data?.data?.api_keys || []
  const sendingKeys = keys.filter((key) => key.key_type !== 'ai_agent')
  const aiKeys = keys.filter((key) => key.key_type === 'ai_agent')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    queryClient.invalidateQueries({ queryKey: ['account-usage'] })
  }

  const onError = (fallback: string) => (error: any) => {
    toast.error(error.response?.data?.message || error.response?.data?.error || fallback)
  }

  const createMutation = useMutation({
    mutationFn: () => apiKeyApi.createApiKey({ key_name: keyName.trim(), permissions }),
    onSuccess: (response) => {
      refresh()
      setCreateOpen(false)
      setKeyName('')
      setPermissions([...apiKeyPresets[0].permissions])
      setLatestKey(response.data.key)
    },
    onError: onError('Não foi possível criar a chave'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.deleteApiKey(String(id)),
    onSuccess: () => {
      refresh()
      setDeleteTarget(null)
      toast.success('Chave excluída')
    },
    onError: onError('Não foi possível excluir a chave'),
  })

  const regenerateMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.regenerateApiKey(String(id)),
    onSuccess: (response) => {
      refresh()
      setRegenerateTarget(null)
      setLatestKey(response.data.key)
    },
    onError: onError('Não foi possível gerar a nova chave'),
  })

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.toggleApiKey(String(id)),
    onSuccess: refresh,
    onError: onError('Não foi possível atualizar a chave'),
  })

  const togglePermission = (permission: string) => {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]
    )
  }

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault()
    if (!keyName.trim()) {
      toast.error('Dê um nome para a chave')
      return
    }
    if (permissions.length === 0) {
      toast.error('Escolha o que a chave pode fazer')
      return
    }
    createMutation.mutate()
  }

  const rowHandlers = {
    onToggle: (key: ApiKey) => toggleMutation.mutate(key.id),
    onRegenerate: setRegenerateTarget,
    onDelete: setDeleteTarget,
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Chaves de API" />

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <KeySection
            icon={Send}
            title="Chaves de envio"
            description="Use no código do seu site ou sistema para enviar emails."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nova chave
              </Button>
            }
            keys={sendingKeys}
            emptyText="Nenhuma chave de envio ainda."
            {...rowHandlers}
          />

          <KeySection
            icon={Sparkles}
            title="Chave da IA"
            description="Permite que o Cursor ou o VS Code configurem sua conta. Não use no seu sistema."
            action={
              <Button variant="outline" onClick={() => setAiOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Configurar com IA
              </Button>
            }
            keys={aiKeys}
            emptyText="Nenhum editor conectado."
            {...rowHandlers}
          />
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova chave de envio</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="key_name">Nome</Label>
              <Input
                id="key_name"
                placeholder="Ex: Meu site"
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>O que ela pode fazer?</Label>
              <div className="grid gap-2">
                {apiKeyPresets.map((preset) => {
                  const active = preset.permissions.length === permissions.length
                    && preset.permissions.every((permission) => permissions.includes(permission))

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setPermissions([...preset.permissions])}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        active ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
                      }`}
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="text-xs text-muted-foreground">{preset.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Escolher permissões uma a uma
              </summary>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {apiPermissionCatalog.map((permission) => (
                  <label key={permission.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission.id)}
                      onChange={() => togglePermission(permission.id)}
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Criando...' : 'Criar chave'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(latestKey)} onOpenChange={(open) => !open && setLatestKey(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Sua chave está pronta</DialogTitle>
            <DialogDescription>Copie agora. Por segurança, ela não aparece de novo.</DialogDescription>
          </DialogHeader>
          {latestKey && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm">{latestKey}</code>
                <Button size="sm" onClick={() => copyToClipboard(latestKey).then(() => toast.success('Chave copiada'))}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
              </div>
              <CodeSnippetCard title="Teste no terminal" code={buildSendEmailCurlExample(latestKey)} language="bash" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AiSetupDialog open={aiOpen} onOpenChange={setAiOpen} />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Excluir chave"
        description={deleteTarget ? `Excluir "${deleteTarget.key_name}"? Sistemas que usam essa chave vão parar de funcionar.` : ''}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={Boolean(regenerateTarget)}
        onClose={() => setRegenerateTarget(null)}
        onConfirm={() => regenerateTarget && regenerateMutation.mutate(regenerateTarget.id)}
        title="Gerar nova chave"
        description={regenerateTarget ? `A chave atual de "${regenerateTarget.key_name}" deixa de funcionar na hora.` : ''}
        variant="info"
      />
    </div>
  )
}
