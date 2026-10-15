import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BarChart3, Copy, Key, MoreVertical, Pencil, Plus, RotateCcw, Settings, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiKeyApi } from '@/lib/api'
import { CodeSnippetCard } from '@/components/developer/CodeSnippetCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page'
import { copyToClipboard, formatRelativeTime } from '@/lib/utils'
import {
  apiKeyPresets,
  apiPermissionCatalog,
  buildSendEmailCurlExample,
} from '@/lib/developerPortal'

const createApiKeySchema = z.object({
  key_name: z.string().min(1, 'Nome e obrigatorio').max(100),
  permissions: z.array(z.string()).min(1, 'Selecione pelo menos uma permissao'),
})

type CreateApiKeyForm = z.infer<typeof createApiKeySchema>

interface ApiKey {
  id: number
  key_name: string
  permissions: string[]
  created_at: string
  last_used_at: string | null
  is_active: boolean
  api_key_preview: string
}

interface ApiKeyUsage {
  api_key: {
    id: number
    key_name: string
    last_used_at: string | null
    is_active: boolean
    api_key_preview: string
  }
  usage_stats: {
    period: string
    total_emails: number
    sent_emails: number
    delivered_emails: number
    opened_emails?: number
    clicked_emails?: number
    bounced_emails: number
    failed_emails: number
    daily_usage: Array<{ date: string; count: number }>
  }
}

const availablePermissions = apiPermissionCatalog

export function ApiKeys() {
  const queryClient = useQueryClient()
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [latestKey, setLatestKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<ApiKey | null>(null)
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null)
  const [usageTarget, setUsageTarget] = useState<ApiKey | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<CreateApiKeyForm>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      key_name: '',
      permissions: [...apiKeyPresets[0].permissions],
    },
  })

  const editForm = useForm<CreateApiKeyForm>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      key_name: '',
      permissions: [],
    },
  })

  const selectedPermissions = watch('permissions') || []

  const { data: apiKeysResponse, isLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: apiKeyApi.getApiKeys,
  })

  const keys: ApiKey[] = apiKeysResponse?.data?.api_keys || []

  useEffect(() => {
    if (!editingKey) {
      return
    }

    editForm.reset({
      key_name: editingKey.key_name,
      permissions: editingKey.permissions,
    })
  }, [editForm, editingKey])

  const { data: usageResponse, isLoading: usageLoading } = useQuery({
    queryKey: ['apiKeyUsage', usageTarget?.id],
    queryFn: async () => {
      const response = await apiKeyApi.getApiKeyUsage(String(usageTarget?.id))
      return response.data as ApiKeyUsage
    },
    enabled: Boolean(usageTarget),
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateApiKeyForm) =>
      apiKeyApi.createApiKey({
        key_name: data.key_name,
        permissions: data.permissions,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setLatestKey(response.data.key)
      setShowCreateCard(false)
      reset()
      queryClient.invalidateQueries({ queryKey: ['account-usage'] })
      toast.success('Chave criada')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao criar API Key')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.deleteApiKey(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setDeleteTarget(null)
      toast.success('API Key removida')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao remover API Key')
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.regenerateApiKey(String(id)),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setLatestKey(response.data.key)
      setRegenerateTarget(null)
      toast.success('API Key regenerada')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao regenerar API Key')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiKeyApi.toggleApiKey(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      toast.success('Status atualizado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao atualizar status')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateApiKeyForm }) =>
      apiKeyApi.updateApiKey(String(id), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setEditingKey(null)
      toast.success('API Key atualizada')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao atualizar API Key')
    },
  })

  const onSubmit = (data: CreateApiKeyForm) => {
    createMutation.mutate(data)
  }

  const handlePermissionToggle = (permission: string) => {
    const updated = selectedPermissions.includes(permission)
      ? selectedPermissions.filter((item) => item !== permission)
      : [...selectedPermissions, permission]

    setValue('permissions', updated)
  }

  const handleCopyLatestKey = async () => {
    if (!latestKey) {
      return
    }

    try {
      await copyToClipboard(latestKey)
      toast.success('API Key copiada')
    } catch {
      toast.error('Erro ao copiar API Key')
    }
  }

  const editSelectedPermissions = editForm.watch('permissions') || []

  const handleEditPermissionToggle = (permission: string) => {
    const updated = editSelectedPermissions.includes(permission)
      ? editSelectedPermissions.filter((item) => item !== permission)
      : [...editSelectedPermissions, permission]

    editForm.setValue('permissions', updated)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chaves de API"
        actions={
          <Button onClick={() => setShowCreateCard(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova chave
          </Button>
        }
      />

      {latestKey && (
        <Card className="border-[hsl(var(--success)/.3)] bg-[hsl(var(--success)/.08)]">
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-foreground">Sua chave está pronta</h3>
                <p className="text-sm text-muted-foreground">Copie agora. Por segurança, ela não aparece de novo.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLatestKey(null)}>
                Fechar
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm">{latestKey}</code>
              <Button size="sm" onClick={handleCopyLatestKey}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
            </div>
            <CodeSnippetCard
              title="Teste agora"
              code={buildSendEmailCurlExample(latestKey)}
              language="bash"
            />
          </CardContent>
        </Card>
      )}

      {showCreateCard && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>Nova chave</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="key_name">Nome</Label>
                <Input id="key_name" placeholder="Ex: Meu site" {...register('key_name')} />
                {errors.key_name && <p className="text-sm text-destructive">{errors.key_name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>O que esta chave pode fazer?</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {apiKeyPresets.map((preset) => {
                    const active = preset.permissions.length === selectedPermissions.length
                      && preset.permissions.every((permission) => selectedPermissions.includes(permission))

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setValue('permissions', [...preset.permissions])}
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                          active ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
                        }`}
                      >
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-xs text-muted-foreground">{preset.description}</div>
                      </button>
                    )
                  })}
                </div>
                {errors.permissions && <p className="text-sm text-destructive">{errors.permissions.message}</p>}
              </div>

              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Permissões avançadas
                </summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {availablePermissions.map((permission) => (
                    <button
                      key={permission.id}
                      type="button"
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selectedPermissions.includes(permission.id)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => handlePermissionToggle(permission.id)}
                    >
                      <div className="text-sm font-medium">{permission.label}</div>
                      <div className="text-xs text-muted-foreground">{permission.description}</div>
                    </button>
                  ))}
                </div>
              </details>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCreateCard(false)
                    reset()
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Criando...' : 'Criar chave'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="pt-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="h-3 w-56 rounded bg-muted" />
                  <div className="h-16 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : keys.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <Key className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">Nenhuma chave ainda</h3>
                <p className="mb-4 text-muted-foreground">Crie uma chave para enviar emails pelo seu sistema.</p>
                <Button onClick={() => setShowCreateCard(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Criar chave
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          keys.map((apiKey) => (
            <Card key={apiKey.id} className={!apiKey.is_active ? 'opacity-70' : ''}>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <Key className="h-5 w-5 text-primary" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg">{apiKey.key_name}</CardTitle>
                      <CardDescription>
                        Criada {formatRelativeTime(apiKey.created_at)}
                        {apiKey.last_used_at ? ` • Ultimo uso ${formatRelativeTime(apiKey.last_used_at)}` : ' • Nunca usada'}
                      </CardDescription>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={apiKey.is_active ? 'default' : 'secondary'}>
                      {apiKey.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setUsageTarget(apiKey)}>
                      <BarChart3 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingKey(apiKey)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleKey(apiKey.id)} disabled={toggleMutation.isPending}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRegenerateTarget(apiKey)} disabled={regenerateMutation.isPending}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <div className="relative group">
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      <div className="invisible absolute right-0 z-10 mt-2 w-[min(12rem,calc(100vw-1rem))] rounded-lg border bg-white opacity-0 shadow-lg transition-all duration-200 group-hover:visible group-hover:opacity-100">
                        <div className="space-y-1 p-2">
                          <button
                            onClick={() => setUsageTarget(apiKey)}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <BarChart3 className="h-4 w-4" />
                            Ver uso
                          </button>
                          <button
                            onClick={() => setEditingKey(apiKey)}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <Pencil className="h-4 w-4" />
                            Editar
                          </button>
                          <button
                            onClick={() => handleToggleKey(apiKey.id)}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <Settings className="h-4 w-4" />
                            {apiKey.is_active ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            onClick={() => setRegenerateTarget(apiKey)}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Regenerar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(apiKey)}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Preview da chave</Label>
                  <div className="space-y-2 rounded-lg border bg-muted/45 p-3">
                    <code className="block text-sm font-mono">{apiKey.api_key_preview}</code>
                    <p className="text-xs text-muted-foreground">
                      O preview serve apenas para identificar a chave. A chave completa so aparece na criacao ou regeneracao.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Permissoes</Label>
                  <div className="flex flex-wrap gap-2">
                    {apiKey.permissions.map((permission) => {
                      const permissionInfo = availablePermissions.find((item) => item.id === permission)
                      return (
                        <Badge key={permission} variant="outline">
                          {permissionInfo?.label || permission}
                        </Badge>
                      )
                    })}
                  </div>
                </div>

                <div className="grid gap-4 rounded-lg border bg-muted/45 p-3 md:grid-cols-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className="font-medium">{apiKey.is_active ? 'Ativa' : 'Inativa'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Criada</div>
                    <div className="font-medium">{formatRelativeTime(apiKey.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Ultimo uso</div>
                    <div className="font-medium">{apiKey.last_used_at ? formatRelativeTime(apiKey.last_used_at) : 'Nunca'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Permissoes</div>
                    <div className="font-medium">{apiKey.permissions.length}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id)
          }
        }}
        title="Remover API Key"
        description={deleteTarget ? `Deseja remover a chave "${deleteTarget.key_name}"? Esta acao nao pode ser desfeita.` : ''}
        variant="danger"
      />

      <Dialog open={Boolean(editingKey)} onOpenChange={(open) => !open && setEditingKey(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar API Key</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={editForm.handleSubmit((data) => {
              if (!editingKey) {
                return
              }

              updateMutation.mutate({ id: editingKey.id, data })
            })}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-key-name">Nome</Label>
              <Input id="edit-key-name" placeholder="Ex: Aplicacao de producao" {...editForm.register('key_name')} />
              {editForm.formState.errors.key_name && <p className="text-sm text-destructive">{editForm.formState.errors.key_name.message}</p>}
            </div>

            <div className="space-y-3">
              <Label>Permissoes</Label>
              <div className="grid gap-3 md:grid-cols-2">
                {availablePermissions.map((permission) => (
                  <button
                    key={permission.id}
                    type="button"
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      editSelectedPermissions.includes(permission.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                    onClick={() => handleEditPermissionToggle(permission.id)}
                  >
                    <div className="font-medium text-sm">{permission.label}</div>
                    <div className="text-xs text-muted-foreground">{permission.description}</div>
                  </button>
                ))}
              </div>
              {editForm.formState.errors.permissions && <p className="text-sm text-destructive">{editForm.formState.errors.permissions.message}</p>}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingKey(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Salvando...' : 'Salvar alteracoes'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(usageTarget)} onOpenChange={(open) => !open && setUsageTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Uso da API Key</DialogTitle>
          </DialogHeader>

          {usageLoading || !usageResponse ? (
            <div className="py-8 text-center text-muted-foreground">Carregando metricas...</div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-lg border bg-muted/45 p-4">
                <div className="font-medium">{usageResponse.api_key.key_name}</div>
                <div className="text-sm text-muted-foreground">{usageResponse.api_key.api_key_preview}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Periodo: {usageResponse.usage_stats.period} • Ultimo uso:{' '}
                  {usageResponse.api_key.last_used_at ? formatRelativeTime(usageResponse.api_key.last_used_at) : 'Nunca'}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="text-2xl font-bold">{usageResponse.usage_stats.total_emails}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Aceitos SMTP</div>
                    <div className="text-2xl font-bold">{usageResponse.usage_stats.delivered_emails}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Abertos / cliques</div>
                    <div className="text-2xl font-bold">
                      {usageResponse.usage_stats.opened_emails || 0} / {usageResponse.usage_stats.clicked_emails || 0}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Falhas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>Bounces</span>
                      <span className="font-medium">{usageResponse.usage_stats.bounced_emails}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Falhas</span>
                      <span className="font-medium">{usageResponse.usage_stats.failed_emails}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Volume diario</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {usageResponse.usage_stats.daily_usage.length === 0 ? (
                      <div className="text-muted-foreground">Nenhum envio no periodo.</div>
                    ) : (
                      usageResponse.usage_stats.daily_usage.slice(-7).map((entry) => (
                        <div key={entry.date} className="flex items-center justify-between gap-2">
                          <span>{entry.date}</span>
                          <span className="font-medium">{entry.count}</span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={Boolean(regenerateTarget)}
        onClose={() => setRegenerateTarget(null)}
        onConfirm={() => {
          if (regenerateTarget) {
            regenerateMutation.mutate(regenerateTarget.id)
          }
        }}
        title="Regenerar API Key"
        description={regenerateTarget ? `Regenerar a chave "${regenerateTarget.key_name}"? A chave atual sera invalidada.` : ''}
        variant="info"
      />
    </div>
  )

  function handleToggleKey(id: number) {
    toggleMutation.mutate(id)
  }
}
