import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Building2,
  Clock3,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  Palette,
  Save,
  Send,
  Shield,
  UserRound,
  UserRoundPlus,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page'
import { useAccountUsage } from '@/hooks/useAccountUsage'
import { authApi, organizationsApi, settingsApi } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { useAuthStore, useSettingsStore, useThemeStore } from '@/lib/store'

type WorkspaceRole = 'owner' | 'admin' | 'member'

type ToggleSettingItem = {
  key: keyof SettingsResponse['account_preferences']['sending_settings']
  label: string
  Icon: LucideIcon
}

interface SettingsResponse {
  workspace: {
    organization_id: number | null
    organization_name: string
    organization_slug: string
    role: WorkspaceRole
    account_user_id: number
    is_personal: boolean
  }
  profile: {
    id: number
    name: string
    email: string
    is_verified: boolean
    is_active: boolean
  }
  plan: {
    name: string
    status: string
    expires_at: string | null
  }
  personal_preferences: {
    notification_preferences: Record<string, boolean>
    system_preferences: {
      theme: 'light' | 'dark' | 'system'
      language: string
      timezone: string
      date_format: string
      time_format: '12h' | '24h'
      items_per_page: number
      auto_refresh: boolean
      auto_refresh_interval: number
    }
    security_settings: {
      session_timeout: number
      require_password_confirmation: boolean
      ip_whitelist: string[]
      two_factor_enabled: boolean
      api_rate_limit: number
    }
  }
  account_preferences: {
    smtp_settings: {
      use_custom: boolean
      host: string
      port: number | null
      username: string
      password_configured: boolean
      use_tls: boolean
    }
    branding_settings: {
      company_name: string
      company_logo_url: string
      custom_domain: string
      footer_text: string
      primary_color: string
      secondary_color: string
    }
    analytics_settings: {
      default_time_range: '24h' | '7d' | '30d' | '90d'
      track_opens: boolean
      track_clicks: boolean
      track_downloads: boolean
      pixel_tracking: boolean
      utm_tracking: boolean
    }
    sending_settings: {
      timezone: string
      default_from_email: string
      default_from_name: string
      bounce_handling: boolean
      open_tracking: boolean
      click_tracking: boolean
      unsubscribe_tracking: boolean
      suppression_list_enabled: boolean
    }
    webhook_settings: {
      enabled: boolean
      webhook_url: string
      webhook_secret_configured: boolean
      custom_headers: Record<string, string>
    }
  }
}

interface WorkspaceContextResponse {
  workspace: {
    organizationId: number | null
    organizationName: string
    organizationSlug: string
    role: WorkspaceRole
    accountUserId: number
    memberships: Array<{
      organizationId: number
      organizationName: string
      organizationSlug: string
      role: WorkspaceRole
      isPersonal: boolean
      ownerUserId: number
    }>
    isPersonal: boolean
  }
  members: Array<{
    membershipId: number
    userId: number
    email: string
    name: string
    role: WorkspaceRole
    joinedAt: string
  }>
  pending_invitations: Array<{
    id: number
    email: string
    role: WorkspaceRole
    status: string
    token: string
    organizationId: number
    organizationName: string
    createdAt: string
  }>
  received_invitations: Array<{
    id: number
    email: string
    role: WorkspaceRole
    status: string
    token: string
    organizationId: number
    organizationName: string
    createdAt: string
  }>
}

const notificationLabels: Record<string, string> = {
  email_delivery_reports: 'Relatorios de entrega',
  bounce_notifications: 'Alertas de bounce',
  daily_summary: 'Resumo diario',
  weekly_reports: 'Resumo semanal',
  security_alerts: 'Alertas de seguranca',
  webhook_failures: 'Falhas de webhook',
}

const roleLabels: Record<WorkspaceRole, string> = {
  owner: 'Dono',
  admin: 'Admin',
  member: 'Membro',
}

function PlanCard() {
  const { data } = useAccountUsage()
  if (!data) return null

  const { limits } = data.plan
  const rows = [
    { label: 'Emails no mês', used: data.usage.emailsThisMonth, limit: limits.emailsPerMonth },
    { label: 'Emails hoje', used: data.usage.emailsToday, limit: limits.emailsPerDay },
    { label: 'Domínios', used: data.usage.domains, limit: limits.domainsLimit },
    { label: 'Webhooks', used: data.usage.activeWebhooks, limit: limits.webhooksLimit },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plano {data.plan.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => {
          const percentage = row.limit > 0 ? Math.min(100, (row.used / row.limit) * 100) : 0
          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">{formatNumber(row.used)} / {formatNumber(row.limit)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={percentage >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function Settings() {
  const queryClient = useQueryClient()
  const updateUser = useAuthStore((state) => state.updateUser)
  const updateAppSettings = useSettingsStore((state) => state.updateSettings)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [settingsForm, setSettingsForm] = useState<SettingsResponse | null>(null)
  const [profileForm, setProfileForm] = useState({ name: '' })
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' as 'admin' | 'member' })
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [smtpPassword, setSmtpPassword] = useState('')
  const sendingToggleItems: ToggleSettingItem[] = [
    { key: 'open_tracking', label: 'Rastrear aberturas', Icon: Mail },
    { key: 'click_tracking', label: 'Rastrear cliques', Icon: Send },
    { key: 'bounce_handling', label: 'Tratar bounces', Icon: Shield },
    { key: 'unsubscribe_tracking', label: 'Rastrear descadastros', Icon: Globe2 },
    { key: 'suppression_list_enabled', label: 'Bloquear endereços com falha', Icon: Bell },
  ]

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getSettings(),
  })

  const workspaceQuery = useQuery({
    queryKey: ['workspace-context'],
    queryFn: () => organizationsApi.getContext(),
  })

  useEffect(() => {
    const settings = settingsQuery.data?.data?.settings as SettingsResponse | undefined
    if (!settings) return

    setSettingsForm(settings)
    setProfileForm({ name: settings.profile.name || '' })
    setWorkspaceName(settings.workspace.organization_name || '')
    setSmtpPassword('')
    updateAppSettings({
      emailsPerPage: settings.personal_preferences.system_preferences.items_per_page,
      autoRefresh: settings.personal_preferences.system_preferences.auto_refresh,
      refreshInterval: settings.personal_preferences.system_preferences.auto_refresh_interval,
      language: settings.personal_preferences.system_preferences.language as 'pt-BR' | 'en-US',
      analyticsDefaultTimeRange: settings.account_preferences.analytics_settings.default_time_range,
      theme: settings.personal_preferences.system_preferences.theme,
      timezone: settings.personal_preferences.system_preferences.timezone,
      dateFormat: settings.personal_preferences.system_preferences.date_format,
      timeFormat: settings.personal_preferences.system_preferences.time_format,
    })
    setTheme(settings.personal_preferences.system_preferences.theme)
  }, [setTheme, settingsQuery.data, updateAppSettings])

  const workspaceData = workspaceQuery.data?.data as WorkspaceContextResponse | undefined
  const members = workspaceData?.members || []
  const pendingInvitations = workspaceData?.pending_invitations || []
  const receivedInvitations = workspaceData?.received_invitations || []
  const memberships = workspaceData?.workspace.memberships || []
  const canManageWorkspace = settingsForm?.workspace.role === 'owner' || settingsForm?.workspace.role === 'admin'

  const invalidateSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace-context'] }),
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
    ])
  }

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => settingsApi.updateSettings(payload),
    onSuccess: async () => {
      await invalidateSettings()
      toast.success('Configuracoes atualizadas')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao atualizar configuracoes')
    },
  })

  const updateProfileMutation = useMutation({
    mutationFn: () => authApi.updateProfile({ name: profileForm.name.trim() }),
    onSuccess: async (response) => {
      updateUser(response.data.user)
      await invalidateSettings()
      toast.success('Perfil atualizado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao atualizar perfil')
    },
  })

  const updatePasswordMutation = useMutation({
    mutationFn: () => authApi.changePassword({
      current_password: passwordForm.current_password,
      new_password: passwordForm.new_password,
    }),
    onSuccess: () => {
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      toast.success('Senha atualizada')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao atualizar senha')
    },
  })

  const switchOrganizationMutation = useMutation({
    mutationFn: (organizationId: number) => organizationsApi.switchOrganization(organizationId),
    onSuccess: async () => {
      await invalidateSettings()
      toast.success('Workspace alterado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao trocar workspace')
    },
  })

  const updateWorkspaceMutation = useMutation({
    mutationFn: () => organizationsApi.updateCurrentOrganization({ name: workspaceName.trim() }),
    onSuccess: async () => {
      await invalidateSettings()
      toast.success('Workspace atualizado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao atualizar workspace')
    },
  })

  const inviteMutation = useMutation({
    mutationFn: () => organizationsApi.createInvitation(inviteForm),
    onSuccess: async () => {
      setInviteForm({ email: '', role: 'member' })
      await invalidateSettings()
      toast.success('Convite criado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao criar convite')
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: number) => organizationsApi.removeMember(membershipId),
    onSuccess: async () => {
      await invalidateSettings()
      toast.success('Membro removido')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao remover membro')
    },
  })

  const respondInvitationMutation = useMutation({
    mutationFn: ({ token, action }: { token: string; action: 'accept' | 'decline' }) =>
      action === 'accept'
        ? organizationsApi.acceptInvitation(token)
        : organizationsApi.declineInvitation(token),
    onSuccess: async (_response, variables) => {
      await invalidateSettings()
      toast.success(variables.action === 'accept' ? 'Convite aceito' : 'Convite recusado')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Falha ao responder convite')
    },
  })

  const loading = settingsQuery.isLoading || workspaceQuery.isLoading || !settingsForm

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando configuracoes...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />

      <Tabs defaultValue="account" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-2xl bg-transparent p-0">
          <TabsTrigger value="account">Conta</TabsTrigger>
          <TabsTrigger value="workspace">Equipe</TabsTrigger>
          <TabsTrigger value="sending">Envio</TabsTrigger>
          <TabsTrigger value="experience">Preferências</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-6">
          <PlanCard />
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="h-5 w-5" />
                  Perfil da conta
                </CardTitle>
                <CardDescription>
                  Dados do usuario autenticado e indicadores do workspace ativo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="settings-name">Nome</Label>
                    <Input
                      id="settings-name"
                      value={profileForm.name}
                      onChange={(event) => setProfileForm({ name: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="settings-email">Email</Label>
                    <Input id="settings-email" value={settingsForm.profile.email} disabled />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
                    <div className="mt-2 font-semibold">{settingsForm.workspace.organization_name}</div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Role</div>
                    <div className="mt-2 font-semibold">{roleLabels[settingsForm.workspace.role]}</div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Conta</div>
                    <div className="mt-2 font-semibold">{settingsForm.profile.is_active ? 'Ativa' : 'Inativa'}</div>
                  </div>
                </div>
                <Button
                  onClick={() => updateProfileMutation.mutate()}
                  disabled={updateProfileMutation.isPending || !profileForm.name.trim()}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {updateProfileMutation.isPending ? 'Salvando...' : 'Salvar perfil'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Senha e acesso
                </CardTitle>
                <CardDescription>
                  Atualize a senha e use chaves/API webhooks no fluxo de automacao.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="current-password">Senha atual</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={passwordForm.current_password}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="new-password">Nova senha</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
                  />
                </div>
                <Button
                  onClick={() => {
                    if (passwordForm.new_password.length < 8) {
                      toast.error('A nova senha precisa ter ao menos 8 caracteres')
                      return
                    }

                    if (passwordForm.new_password !== passwordForm.confirm_password) {
                      toast.error('A confirmacao da senha nao confere')
                      return
                    }

                    updatePasswordMutation.mutate()
                  }}
                  disabled={updatePasswordMutation.isPending}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  {updatePasswordMutation.isPending ? 'Atualizando...' : 'Atualizar senha'}
                </Button>
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Developer access</div>
                  <p className="mt-2">Use API Keys, Webhooks e a documentacao tecnica para integrar a conta compartilhada do workspace.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/api-keys">API Keys</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/webhooks">Webhooks</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/developers">Developer Docs</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="workspace" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Contexto do workspace
                </CardTitle>
                <CardDescription>
                  Troque de workspace, renomeie o atual e controle quem pode operar a conta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Workspace ativo</Label>
                  <Select
                    value={String(settingsForm.workspace.organization_id || '')}
                    onValueChange={(value) => switchOrganizationMutation.mutate(Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {memberships.map((membership) => (
                        <SelectItem key={membership.organizationId} value={String(membership.organizationId)}>
                          {membership.organizationName} · {roleLabels[membership.role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="workspace-name">Nome do workspace</Label>
                  <Input
                    id="workspace-name"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    disabled={!canManageWorkspace}
                  />
                </div>
                <Button
                  onClick={() => updateWorkspaceMutation.mutate()}
                  disabled={!canManageWorkspace || updateWorkspaceMutation.isPending || workspaceName.trim().length < 2}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {updateWorkspaceMutation.isPending ? 'Salvando...' : 'Salvar workspace'}
                </Button>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Members</div>
                    <div className="mt-2 text-2xl font-semibold">{members.length}</div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Invites pendentes</div>
                    <div className="mt-2 text-2xl font-semibold">{pendingInvitations.length}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Time e convites
                </CardTitle>
                <CardDescription>
                  Owners e admins podem convidar operadores e compartilhar dominos, templates e analytics da mesma conta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr_0.6fr_auto]">
                  <div>
                    <Label htmlFor="invite-email">Email do membro</Label>
                    <Input
                      id="invite-email"
                      value={inviteForm.email}
                      onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="membro@empresa.com"
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <Select
                      value={inviteForm.role}
                      onValueChange={(value: 'admin' | 'member') => setInviteForm((current) => ({ ...current, role: value }))}
                      disabled={!canManageWorkspace}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 flex items-end">
                    <Button
                      onClick={() => inviteMutation.mutate()}
                      disabled={!canManageWorkspace || inviteMutation.isPending || !inviteForm.email.trim()}
                    >
                      <UserRoundPlus className="mr-2 h-4 w-4" />
                      Convidar
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {members.map((member) => (
                    <div key={member.membershipId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
                      <div>
                        <div className="font-medium">{member.name}</div>
                        <div className="text-sm text-muted-foreground">{member.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{roleLabels[member.role]}</Badge>
                        {canManageWorkspace && member.role !== 'owner' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeMemberMutation.mutate(member.membershipId)}
                            disabled={removeMemberMutation.isPending}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Remover
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {pendingInvitations.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Convites emitidos</div>
                    {pendingInvitations.map((invitation) => (
                      <div key={invitation.id} className="rounded-2xl border border-dashed p-4">
                        <div className="font-medium">{invitation.email}</div>
                        <div className="text-sm text-muted-foreground">
                          Role: {roleLabels[invitation.role]} · Status: {invitation.status}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {receivedInvitations.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Convites para voce</div>
                    {receivedInvitations.map((invitation) => (
                      <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
                        <div>
                          <div className="font-medium">{invitation.organizationName}</div>
                          <div className="text-sm text-muted-foreground">Role sugerida: {roleLabels[invitation.role]}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => respondInvitationMutation.mutate({ token: invitation.token, action: 'accept' })}
                            disabled={respondInvitationMutation.isPending}
                          >
                            Aceitar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => respondInvitationMutation.mutate({ token: invitation.token, action: 'decline' })}
                            disabled={respondInvitationMutation.isPending}
                          >
                            Recusar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sending" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Defaults de envio e tracking
                </CardTitle>
                <CardDescription>
                  Esses defaults afetam a conta compartilhada do workspace e o pipeline real de tracking.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="default-from-email">Default from email</Label>
                    <Input
                      id="default-from-email"
                      value={settingsForm.account_preferences.sending_settings.default_from_email}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            sending_settings: {
                              ...current.account_preferences.sending_settings,
                              default_from_email: event.target.value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <div>
                    <Label htmlFor="default-from-name">Default from name</Label>
                    <Input
                      id="default-from-name"
                      value={settingsForm.account_preferences.sending_settings.default_from_name}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            sending_settings: {
                              ...current.account_preferences.sending_settings,
                              default_from_name: event.target.value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {sendingToggleItems.map(({ key, label, Icon }) => {
                    const typedKey = key
                    return (
                      <div key={key} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{label}</div>
                            <div className="text-sm text-muted-foreground">Controla o comportamento operacional da conta.</div>
                          </div>
                        </div>
                        <Switch
                          checked={Boolean(settingsForm.account_preferences.sending_settings[typedKey])}
                          onCheckedChange={(value) =>
                            setSettingsForm((current) => current ? ({
                              ...current,
                              account_preferences: {
                                ...current.account_preferences,
                                sending_settings: {
                                  ...current.account_preferences.sending_settings,
                                  [typedKey]: value,
                                },
                              },
                            }) : current)
                          }
                          disabled={!canManageWorkspace}
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Periodo padrao do analytics</Label>
                    <Select
                      value={settingsForm.account_preferences.analytics_settings.default_time_range}
                      onValueChange={(value: '24h' | '7d' | '30d' | '90d') =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            analytics_settings: {
                              ...current.account_preferences.analytics_settings,
                              default_time_range: value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">24h</SelectItem>
                        <SelectItem value="7d">7 dias</SelectItem>
                        <SelectItem value="30d">30 dias</SelectItem>
                        <SelectItem value="90d">90 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3 rounded-2xl border p-4">
                    {[
                      ['track_opens', 'Medir aberturas'],
                      ['track_clicks', 'Medir cliques'],
                      ['pixel_tracking', 'Injetar pixel'],
                      ['utm_tracking', 'Preparar UTM'],
                    ].map(([key, label]) => {
                      const typedKey = key as keyof SettingsResponse['account_preferences']['analytics_settings']
                      return (
                        <div key={key} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium">{label}</span>
                          <Switch
                            checked={Boolean(settingsForm.account_preferences.analytics_settings[typedKey])}
                            onCheckedChange={(value) =>
                              setSettingsForm((current) => current ? ({
                                ...current,
                                account_preferences: {
                                  ...current.account_preferences,
                                  analytics_settings: {
                                    ...current.account_preferences.analytics_settings,
                                    [typedKey]: value,
                                  },
                                },
                              }) : current)
                            }
                            disabled={!canManageWorkspace}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Button
                  onClick={() => saveSettingsMutation.mutate({
                    sending_settings: settingsForm.account_preferences.sending_settings,
                    analytics_settings: settingsForm.account_preferences.analytics_settings,
                  })}
                  disabled={!canManageWorkspace || saveSettingsMutation.isPending}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saveSettingsMutation.isPending ? 'Salvando...' : 'Salvar defaults de envio'}
                </Button>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    SMTP customizado
                  </CardTitle>
                  <CardDescription>
                    Quando ativo, a conta tenta entregar primeiro pelo relay configurado neste workspace.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">Usar relay SMTP da conta</div>
                      <div className="text-sm text-muted-foreground">
                        Mantem fallback da plataforma se o relay customizado falhar.
                      </div>
                    </div>
                    <Switch
                      checked={settingsForm.account_preferences.smtp_settings.use_custom}
                      onCheckedChange={(value) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            smtp_settings: {
                              ...current.account_preferences.smtp_settings,
                              use_custom: value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="smtp-host">Host SMTP</Label>
                      <Input
                        id="smtp-host"
                        value={settingsForm.account_preferences.smtp_settings.host}
                        onChange={(event) =>
                          setSettingsForm((current) => current ? ({
                            ...current,
                            account_preferences: {
                              ...current.account_preferences,
                              smtp_settings: {
                                ...current.account_preferences.smtp_settings,
                                host: event.target.value,
                              },
                            },
                          }) : current)
                        }
                        disabled={!canManageWorkspace}
                      />
                    </div>
                    <div>
                      <Label htmlFor="smtp-port">Porta</Label>
                      <Input
                        id="smtp-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={settingsForm.account_preferences.smtp_settings.port ?? ''}
                        onChange={(event) =>
                          setSettingsForm((current) => current ? ({
                            ...current,
                            account_preferences: {
                              ...current.account_preferences,
                              smtp_settings: {
                                ...current.account_preferences.smtp_settings,
                                port: event.target.value ? Number(event.target.value) : null,
                              },
                            },
                          }) : current)
                        }
                        disabled={!canManageWorkspace}
                      />
                    </div>
                    <div>
                      <Label htmlFor="smtp-username">Usuario SMTP</Label>
                      <Input
                        id="smtp-username"
                        value={settingsForm.account_preferences.smtp_settings.username}
                        onChange={(event) =>
                          setSettingsForm((current) => current ? ({
                            ...current,
                            account_preferences: {
                              ...current.account_preferences,
                              smtp_settings: {
                                ...current.account_preferences.smtp_settings,
                                username: event.target.value,
                              },
                            },
                          }) : current)
                        }
                        disabled={!canManageWorkspace}
                      />
                    </div>
                    <div>
                      <Label htmlFor="smtp-password">
                        Senha SMTP {settingsForm.account_preferences.smtp_settings.password_configured ? '(ja configurada)' : ''}
                      </Label>
                      <Input
                        id="smtp-password"
                        type="password"
                        value={smtpPassword}
                        placeholder={settingsForm.account_preferences.smtp_settings.password_configured ? 'Digite para substituir' : 'Digite a senha'}
                        onChange={(event) => setSmtpPassword(event.target.value)}
                        disabled={!canManageWorkspace}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">Usar TLS</div>
                      <div className="text-sm text-muted-foreground">
                        Ative quando o relay exigir conexao segura na porta configurada.
                      </div>
                    </div>
                    <Switch
                      checked={settingsForm.account_preferences.smtp_settings.use_tls}
                      onCheckedChange={(value) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            smtp_settings: {
                              ...current.account_preferences.smtp_settings,
                              use_tls: value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    />
                  </div>

                  <Button
                    onClick={() => saveSettingsMutation.mutate({
                      smtp_settings: {
                        ...settingsForm.account_preferences.smtp_settings,
                        password: smtpPassword || undefined,
                      },
                    })}
                    disabled={!canManageWorkspace || saveSettingsMutation.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar SMTP
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    Assinatura dos emails
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="branding-company-name">Nome da empresa</Label>
                      <Input
                        id="branding-company-name"
                        value={settingsForm.account_preferences.branding_settings.company_name}
                        onChange={(event) =>
                          setSettingsForm((current) => current ? ({
                            ...current,
                            account_preferences: {
                              ...current.account_preferences,
                              branding_settings: {
                                ...current.account_preferences.branding_settings,
                                company_name: event.target.value,
                              },
                            },
                          }) : current)
                        }
                        disabled={!canManageWorkspace}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="branding-footer-text">Rodapé</Label>
                    <Textarea
                      id="branding-footer-text"
                      value={settingsForm.account_preferences.branding_settings.footer_text}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          account_preferences: {
                            ...current.account_preferences,
                            branding_settings: {
                              ...current.account_preferences.branding_settings,
                              footer_text: event.target.value,
                            },
                          },
                        }) : current)
                      }
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <Button
                    onClick={() => saveSettingsMutation.mutate({
                      branding_settings: settingsForm.account_preferences.branding_settings,
                    })}
                    disabled={!canManageWorkspace || saveSettingsMutation.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="experience" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe2 className="h-5 w-5" />
                  Preferencias pessoais
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Tema</Label>
                    <Select
                      value={settingsForm.personal_preferences.system_preferences.theme}
                      onValueChange={(value: 'light' | 'dark' | 'system') =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              theme: value,
                            },
                          },
                        }) : current)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Claro</SelectItem>
                        <SelectItem value="dark">Escuro</SelectItem>
                        <SelectItem value="system">Sistema</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Idioma</Label>
                    <Select
                      value={settingsForm.personal_preferences.system_preferences.language}
                      onValueChange={(value) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              language: value,
                            },
                          },
                        }) : current)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pt-BR">Portugues</SelectItem>
                        <SelectItem value="en-US">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Timezone</Label>
                    <Select
                      value={settingsForm.personal_preferences.system_preferences.timezone}
                      onValueChange={(value) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              timezone: value,
                            },
                          },
                        }) : current)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                        <SelectItem value="America/New_York">America/New_York</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Formato de hora</Label>
                    <Select
                      value={settingsForm.personal_preferences.system_preferences.time_format}
                      onValueChange={(value: '12h' | '24h') =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              time_format: value,
                            },
                          },
                        }) : current)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">24 horas</SelectItem>
                        <SelectItem value="12h">12 horas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="items-per-page">Itens por pagina</Label>
                    <Input
                      id="items-per-page"
                      type="number"
                      min={5}
                      max={100}
                      value={settingsForm.personal_preferences.system_preferences.items_per_page}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              items_per_page: Number(event.target.value || 20),
                            },
                          },
                        }) : current)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="refresh-interval">Refresh (ms)</Label>
                    <Input
                      id="refresh-interval"
                      type="number"
                      min={5000}
                      max={300000}
                      step={5000}
                      value={settingsForm.personal_preferences.system_preferences.auto_refresh_interval}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            system_preferences: {
                              ...current.personal_preferences.system_preferences,
                              auto_refresh_interval: Number(event.target.value || 30000),
                            },
                          },
                        }) : current)
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">Atualizacao automatica</div>
                    <div className="text-sm text-muted-foreground">Controla polling das listas e dashboards pessoais.</div>
                  </div>
                  <Switch
                    checked={settingsForm.personal_preferences.system_preferences.auto_refresh}
                    onCheckedChange={(value) =>
                      setSettingsForm((current) => current ? ({
                        ...current,
                        personal_preferences: {
                          ...current.personal_preferences,
                          system_preferences: {
                            ...current.personal_preferences.system_preferences,
                            auto_refresh: value,
                          },
                        },
                      }) : current)
                    }
                  />
                </div>
                <Button
                  onClick={() => saveSettingsMutation.mutate({
                    system_preferences: settingsForm.personal_preferences.system_preferences,
                  })}
                  disabled={saveSettingsMutation.isPending}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar preferencias pessoais
                </Button>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Notificacoes pessoais
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(notificationLabels).map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{label}</div>
                        <div className="text-sm text-muted-foreground">Preferencia individual, sem impacto em outros membros.</div>
                      </div>
                      <Switch
                        checked={Boolean(settingsForm.personal_preferences.notification_preferences[key])}
                        onCheckedChange={(value) =>
                          setSettingsForm((current) => current ? ({
                            ...current,
                            personal_preferences: {
                              ...current.personal_preferences,
                              notification_preferences: {
                                ...current.personal_preferences.notification_preferences,
                                [key]: value,
                              },
                            },
                          }) : current)
                        }
                      />
                    </div>
                  ))}
                  <Button
                    onClick={() => saveSettingsMutation.mutate({
                      notification_preferences: settingsForm.personal_preferences.notification_preferences,
                    })}
                    disabled={saveSettingsMutation.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar notificacoes
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="h-5 w-5" />
                    Politicas pessoais
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="session-timeout">Session timeout (segundos)</Label>
                    <Input
                      id="session-timeout"
                      type="number"
                      min={300}
                      max={86400}
                      value={settingsForm.personal_preferences.security_settings.session_timeout}
                      onChange={(event) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            security_settings: {
                              ...current.personal_preferences.security_settings,
                              session_timeout: Number(event.target.value || 3600),
                            },
                          },
                        }) : current)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">Confirmacao adicional em acoes sensiveis</div>
                      <div className="text-sm text-muted-foreground">Aplica uma politica pessoal para operacoes destrutivas.</div>
                    </div>
                    <Switch
                      checked={settingsForm.personal_preferences.security_settings.require_password_confirmation}
                      onCheckedChange={(value) =>
                        setSettingsForm((current) => current ? ({
                          ...current,
                          personal_preferences: {
                            ...current.personal_preferences,
                            security_settings: {
                              ...current.personal_preferences.security_settings,
                              require_password_confirmation: value,
                            },
                          },
                        }) : current)
                      }
                    />
                  </div>
                  <Button
                    onClick={() => saveSettingsMutation.mutate({
                      security_settings: settingsForm.personal_preferences.security_settings,
                    })}
                    disabled={saveSettingsMutation.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar politicas pessoais
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default Settings
