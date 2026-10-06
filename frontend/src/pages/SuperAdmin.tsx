import { startTransition, useDeferredValue, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, KeyRound, Link2, Loader2, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { superAdminApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

interface Overview {
  accounts: { total: number; active: number }
  users: { total: number; active: number }
  deliverability: {
    total_domains: number
    verified_domains: number
    emails_last_24h: number
    failed_last_24h: number
    success_rate_24h: number
  }
  alerts: { active: number }
}

interface Account {
  id: number
  name: string
  email: string
  is_active: boolean
  is_suspended?: boolean
  email_sending_blocked?: boolean
  plan_name?: string
  monthly_email_limit?: number
  created_at: string
}

interface UserRow {
  id: number
  name: string
  email: string
  is_active: boolean
  is_admin: boolean
  is_verified: boolean
  created_at: string
}

interface DeliverabilityRow {
  domain: string
  total: number
  failed: number
  delivery_rate: number
}

interface AuditLogRow {
  id: number
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  created_at: string
}

interface Pagination {
  page: number
  total_pages: number
  total: number
}

const asPagination = (value: any): Pagination => ({
  page: Number(value?.page || 1),
  total_pages: Number(value?.total_pages || 1),
  total: Number(value?.total || 0)
})

const boolBadge = (value: boolean, ok: string, blocked: string) => (
  <Badge variant={value ? 'success' : 'secondary'}>{value ? ok : blocked}</Badge>
)

export function SuperAdmin() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)

  const [accountSearch, setAccountSearch] = useState('')
  const [accountPage, setAccountPage] = useState(1)
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [days, setDays] = useState(30)
  const [planAccountId, setPlanAccountId] = useState<number | null>(null)
  const [planName, setPlanName] = useState('professional')
  const [planEmailLimit, setPlanEmailLimit] = useState('200000')

  const deferredAccountSearch = useDeferredValue(accountSearch.trim())
  const deferredUserSearch = useDeferredValue(userSearch.trim())

  const accountParams = useMemo(() => ({
    page: accountPage,
    limit: 20,
    search: deferredAccountSearch || undefined
  }), [accountPage, deferredAccountSearch])

  const userParams = useMemo(() => ({
    page: userPage,
    limit: 20,
    search: deferredUserSearch || undefined
  }), [userPage, deferredUserSearch])

  const overviewQuery = useQuery({
    queryKey: ['super-admin', 'overview'],
    queryFn: async () => (await superAdminApi.getOverview()).data.data as Overview
  })

  const accountsQuery = useQuery({
    queryKey: ['super-admin', 'accounts', accountParams],
    queryFn: async () => {
      const payload = (await superAdminApi.getAccounts(accountParams)).data.data
      return {
        accounts: (payload.accounts || []) as Account[],
        pagination: asPagination(payload.pagination)
      }
    }
  })

  const usersQuery = useQuery({
    queryKey: ['super-admin', 'users', userParams],
    queryFn: async () => {
      const payload = (await superAdminApi.getUsers(userParams)).data.data
      return {
        users: (payload.users || []) as UserRow[],
        pagination: asPagination(payload.pagination)
      }
    }
  })

  const deliverabilityQuery = useQuery({
    queryKey: ['super-admin', 'deliverability', days],
    queryFn: async () => (await superAdminApi.getDeliverability(days)).data.data as DeliverabilityRow[]
  })

  const integrationsQuery = useQuery({
    queryKey: ['super-admin', 'integrations'],
    queryFn: async () => (await superAdminApi.getIntegrations()).data.data as {
      webhooks_total: number
      webhook_failures_24h: number
      active_api_keys: number
    }
  })

  const auditQuery = useQuery({
    queryKey: ['super-admin', 'audit', auditPage],
    queryFn: async () => {
      const payload = (await superAdminApi.getAuditLogs({ page: auditPage, limit: 20 })).data.data
      return {
        logs: (payload.logs || []) as AuditLogRow[],
        pagination: asPagination(payload.pagination)
      }
    }
  })

  const updatePlanMutation = useMutation({
    mutationFn: async () => {
      if (!planAccountId) throw new Error('Selecione uma conta')
      await superAdminApi.updateAccountPlan(planAccountId, {
        plan_name: planName,
        reason: 'Atualizacao operacional'
      })
    },
    onSuccess: async () => {
      toast.success('Plano atualizado')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] })
      ])
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || error?.message || 'Falha ao atualizar plano')
    }
  })

  const accountSecurityMutation = useMutation({
    mutationFn: async (payload: { accountId: number; is_suspended?: boolean; email_sending_blocked?: boolean; reason: string }) =>
      superAdminApi.updateAccountSecurity(payload.accountId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })
      ])
    }
  })

  const userStatusMutation = useMutation({
    mutationFn: async (payload: { userId: number; is_active?: boolean; is_admin?: boolean; reason: string }) =>
      superAdminApi.updateUserStatus(payload.userId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'users'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })
      ])
    }
  })

  const refreshAll = async () => {
    await Promise.all([
      overviewQuery.refetch(),
      accountsQuery.refetch(),
      usersQuery.refetch(),
      deliverabilityQuery.refetch(),
      integrationsQuery.refetch(),
      auditQuery.refetch()
    ])
  }

  if (!currentUser?.is_superadmin) {
    return (
      <Card className="border-destructive/25 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Acesso restrito</CardTitle>
          <CardDescription>Esta area e exclusiva para super administradores.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const overview = overviewQuery.data
  const accounts = accountsQuery.data?.accounts || []
  const users = usersQuery.data?.users || []
  const deliverability = deliverabilityQuery.data || []
  const auditLogs = auditQuery.data?.logs || []

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="vm-page-hero">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="vm-page-title">Painel Super Admin</h1>
            <p className="vm-page-description">Controle global de contas, seguranca, entrega e integracoes.</p>
          </div>
          <Button onClick={refreshAll} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Contas ativas</CardDescription><CardTitle>{overview?.accounts.active || 0}</CardTitle></CardHeader><CardContent className="text-sm"><Users className="mr-2 inline h-4 w-4" />Total: {overview?.accounts.total || 0}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Sucesso 24h</CardDescription><CardTitle>{overview?.deliverability.success_rate_24h || 0}%</CardTitle></CardHeader><CardContent className="text-sm"><ShieldCheck className="mr-2 inline h-4 w-4" />Falhas: {overview?.deliverability.failed_last_24h || 0}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Dominios verificados</CardDescription><CardTitle>{overview?.deliverability.verified_domains || 0}</CardTitle></CardHeader><CardContent className="text-sm"><BarChart3 className="mr-2 inline h-4 w-4" />Total: {overview?.deliverability.total_domains || 0}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Alertas ativos</CardDescription><CardTitle>{overview?.alerts.active || 0}</CardTitle></CardHeader><CardContent className="text-sm"><AlertTriangle className="mr-2 inline h-4 w-4" />Emails 24h: {overview?.deliverability.emails_last_24h || 0}</CardContent></Card>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList className="w-full">
          <TabsTrigger value="accounts">Contas</TabsTrigger>
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="deliverability">Entregabilidade</TabsTrigger>
          <TabsTrigger value="integrations">Integracoes</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-3">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={accountSearch} onChange={(event) => startTransition(() => { setAccountSearch(event.target.value); setAccountPage(1) })} placeholder="Buscar conta por email/nome" /></div><div className="grid gap-2 sm:grid-cols-3"><select className="h-10 rounded-md border px-3 text-sm" value={planAccountId ?? ''} onChange={(event) => setPlanAccountId(event.target.value ? Number(event.target.value) : null)}><option value="">Conta para plano</option>{accounts.map((account) => <option key={account.id} value={account.id}>#{account.id} {account.email}</option>)}</select><select className="h-10 rounded-md border px-3 text-sm" value={planName} onChange={(event) => setPlanName(event.target.value)}><option value="free">free</option><option value="professional">professional</option><option value="enterprise">enterprise</option></select><Input type="number" min={1} value={planEmailLimit} onChange={(event) => setPlanEmailLimit(event.target.value)} placeholder="limite/mes" /></div></CardContent><CardContent className="pt-0"><Button onClick={() => updatePlanMutation.mutate()} disabled={updatePlanMutation.isPending}>{updatePlanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Atualizar plano</Button></CardContent></Card>
          <Card><CardContent className="overflow-x-auto pt-6"><table className="w-full min-w-[900px] text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="px-2 py-2 text-left">Conta</th><th className="px-2 py-2 text-left">Plano</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Envio</th><th className="px-2 py-2 text-left">Acoes</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id} className="border-t"><td className="px-2 py-3"><div className="font-medium">{account.name || 'Sem nome'}</div><div className="text-xs text-muted-foreground">#{account.id} - {account.email}</div></td><td className="px-2 py-3"><Badge variant="outline">{account.plan_name || 'free'}</Badge><div className="text-xs text-muted-foreground">{Number(account.monthly_email_limit || 0).toLocaleString('pt-BR')}</div></td><td className="px-2 py-3">{account.is_suspended ? <Badge variant="destructive">Suspensa</Badge> : account.is_active ? <Badge variant="success">Ativa</Badge> : <Badge variant="secondary">Inativa</Badge>}</td><td className="px-2 py-3">{boolBadge(!Boolean(account.email_sending_blocked), 'Liberado', 'Bloqueado')}</td><td className="px-2 py-3"><div className="flex gap-2"><Button size="sm" variant={account.is_suspended ? 'default' : 'destructive'} onClick={() => accountSecurityMutation.mutate({ accountId: account.id, is_suspended: !Boolean(account.is_suspended), reason: 'Atualizacao de seguranca da conta' })}>{account.is_suspended ? 'Reativar' : 'Suspender'}</Button><Button size="sm" variant="outline" onClick={() => accountSecurityMutation.mutate({ accountId: account.id, email_sending_blocked: !Boolean(account.email_sending_blocked), reason: 'Controle de bloqueio de envio' })}>{account.email_sending_blocked ? 'Liberar envio' : 'Bloquear envio'}</Button></div></td></tr>)}</tbody></table></CardContent><CardContent className="flex items-center justify-between pt-0"><span className="text-xs text-muted-foreground">Total: {accountsQuery.data?.pagination.total || 0}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={accountPage <= 1} onClick={() => setAccountPage((current) => Math.max(1, current - 1))}>Anterior</Button><span className="text-xs text-muted-foreground">{accountPage}/{accountsQuery.data?.pagination.total_pages || 1}</span><Button size="sm" variant="outline" disabled={accountPage >= Number(accountsQuery.data?.pagination.total_pages || 1)} onClick={() => setAccountPage((current) => current + 1)}>Proxima</Button></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="users">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={userSearch} onChange={(event) => startTransition(() => { setUserSearch(event.target.value); setUserPage(1) })} placeholder="Buscar usuario por email/nome" /></div></CardContent><CardContent className="overflow-x-auto pt-0"><table className="w-full min-w-[860px] text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="px-2 py-2 text-left">Usuario</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Perfil</th><th className="px-2 py-2 text-left">Acoes</th></tr></thead><tbody>{users.map((row) => <tr key={row.id} className="border-t"><td className="px-2 py-3"><div className="font-medium">{row.name || 'Sem nome'}</div><div className="text-xs text-muted-foreground">#{row.id} - {row.email}</div></td><td className="px-2 py-3">{boolBadge(row.is_active, 'Ativo', 'Inativo')} <span className="ml-2">{boolBadge(row.is_verified, 'Verificado', 'Pendente')}</span></td><td className="px-2 py-3">{row.is_admin ? <Badge>Admin</Badge> : <Badge variant="outline">Cliente</Badge>}</td><td className="px-2 py-3"><div className="flex gap-2"><Button size="sm" variant={row.is_active ? 'destructive' : 'default'} onClick={() => userStatusMutation.mutate({ userId: row.id, is_active: !row.is_active, reason: 'Atualizacao de status de usuario' })}>{row.is_active ? 'Desativar' : 'Ativar'}</Button><Button size="sm" variant="outline" disabled={currentUser.id === row.id && row.is_admin} onClick={() => userStatusMutation.mutate({ userId: row.id, is_admin: !row.is_admin, reason: 'Atualizacao de privilegio admin' })}>{row.is_admin ? 'Remover admin' : 'Promover admin'}</Button></div></td></tr>)}</tbody></table></CardContent><CardContent className="flex items-center justify-between pt-0"><span className="text-xs text-muted-foreground">Total: {usersQuery.data?.pagination.total || 0}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={userPage <= 1} onClick={() => setUserPage((current) => Math.max(1, current - 1))}>Anterior</Button><span className="text-xs text-muted-foreground">{userPage}/{usersQuery.data?.pagination.total_pages || 1}</span><Button size="sm" variant="outline" disabled={userPage >= Number(usersQuery.data?.pagination.total_pages || 1)} onClick={() => setUserPage((current) => current + 1)}>Proxima</Button></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="deliverability">
          <Card><CardHeader><CardTitle className="text-base">Entregabilidade por dominio</CardTitle><CardDescription>Periodo de analise por envio real.</CardDescription></CardHeader><CardContent className="flex justify-end"><select className="h-10 rounded-md border px-3 text-sm" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></CardContent><CardContent className="overflow-x-auto pt-0"><table className="w-full min-w-[760px] text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="px-2 py-2 text-left">Dominio</th><th className="px-2 py-2 text-left">Total</th><th className="px-2 py-2 text-left">Falhas</th><th className="px-2 py-2 text-left">Taxa entrega</th></tr></thead><tbody>{deliverability.map((row) => <tr key={row.domain} className="border-t"><td className="px-2 py-3 font-medium">{row.domain}</td><td className="px-2 py-3">{Number(row.total || 0).toLocaleString('pt-BR')}</td><td className="px-2 py-3 text-destructive">{Number(row.failed || 0).toLocaleString('pt-BR')}</td><td className="px-2 py-3"><Badge variant={row.delivery_rate >= 95 ? 'success' : row.delivery_rate >= 85 ? 'warning' : 'destructive'}>{row.delivery_rate.toFixed(2)}%</Badge></td></tr>)}</tbody></table></CardContent></Card>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="grid gap-3 md:grid-cols-3">
            <Card><CardHeader className="pb-2"><CardDescription>Webhooks</CardDescription><CardTitle>{integrationsQuery.data?.webhooks_total || 0}</CardTitle></CardHeader><CardContent className="text-sm"><Link2 className="mr-2 inline h-4 w-4" />Integracoes registradas</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Falhas webhook (24h)</CardDescription><CardTitle>{integrationsQuery.data?.webhook_failures_24h || 0}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><AlertTriangle className="mr-2 inline h-4 w-4" />Requer acompanhamento</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>API Keys ativas</CardDescription><CardTitle>{integrationsQuery.data?.active_api_keys || 0}</CardTitle></CardHeader><CardContent className="text-sm"><KeyRound className="mr-2 inline h-4 w-4" />Credenciais habilitadas</CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <Card><CardContent className="overflow-x-auto pt-6"><table className="w-full min-w-[820px] text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="px-2 py-2 text-left">Acao</th><th className="px-2 py-2 text-left">Alvo</th><th className="px-2 py-2 text-left">Motivo</th><th className="px-2 py-2 text-left">Data</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={log.id} className="border-t"><td className="px-2 py-3 font-medium">{log.action}</td><td className="px-2 py-3">{log.target_type}{log.target_id ? ` #${log.target_id}` : ''}</td><td className="px-2 py-3">{log.reason || '-'}</td><td className="px-2 py-3">{new Date(log.created_at).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></CardContent><CardContent className="flex items-center justify-between pt-0"><span className="text-xs text-muted-foreground">Total: {auditQuery.data?.pagination.total || 0}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={auditPage <= 1} onClick={() => setAuditPage((current) => Math.max(1, current - 1))}>Anterior</Button><span className="text-xs text-muted-foreground">{auditPage}/{auditQuery.data?.pagination.total_pages || 1}</span><Button size="sm" variant="outline" disabled={auditPage >= Number(auditQuery.data?.pagination.total_pages || 1)} onClick={() => setAuditPage((current) => current + 1)}>Proxima</Button></div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
