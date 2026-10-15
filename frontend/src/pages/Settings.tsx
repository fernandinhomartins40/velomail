import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page'
import { useAccountUsage } from '@/hooks/useAccountUsage'
import { authApi, organizationsApi, settingsApi } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { useAuthStore, useThemeStore } from '@/lib/store'

type WorkspaceRole = 'owner' | 'admin' | 'member'
type Theme = 'light' | 'dark' | 'system'

interface SendingSettings {
  default_from_email: string
  default_from_name: string
  open_tracking: boolean
  click_tracking: boolean
  suppression_list_enabled: boolean
  [key: string]: unknown
}

interface SmtpSettings {
  use_custom: boolean
  host: string
  port: number | null
  username: string
  password_configured: boolean
  use_tls: boolean
}

interface SettingsResponse {
  workspace: { organization_name: string; role: WorkspaceRole }
  profile: { name: string; email: string }
  personal_preferences: { system_preferences: { theme: Theme; [key: string]: unknown } }
  account_preferences: {
    smtp_settings: SmtpSettings
    branding_settings: { company_name: string; footer_text: string; [key: string]: unknown }
    sending_settings: SendingSettings
  }
}

interface WorkspaceContextResponse {
  members: Array<{ membershipId: number; email: string; name: string; role: WorkspaceRole }>
  pending_invitations: Array<{ id: number; email: string; role: WorkspaceRole }>
  received_invitations: Array<{ id: number; token: string; organizationName: string; role: WorkspaceRole }>
}

const roleLabels: Record<WorkspaceRole, string> = { owner: 'Dono', admin: 'Admin', member: 'Membro' }
const selectClassName = 'h-10 rounded-lg border border-input bg-background px-3 text-sm'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="grid gap-4 p-5 md:grid-cols-[220px_1fr] md:gap-8">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="min-w-0 space-y-4">{children}</div>
      </CardContent>
    </Card>
  )
}

function PlanSection() {
  const { data } = useAccountUsage()
  if (!data) return null

  const { limits } = data.plan
  // So o volume de emails alerta em vermelho; dominios e webhooks no limite sao normais.
  const rows = [
    { label: 'Emails no mês', used: data.usage.emailsThisMonth, limit: limits.emailsPerMonth, alert: true },
    { label: 'Emails hoje', used: data.usage.emailsToday, limit: limits.emailsPerDay, alert: true },
    { label: 'Domínios', used: data.usage.domains, limit: limits.domainsLimit, alert: false },
    { label: 'Webhooks', used: data.usage.activeWebhooks, limit: limits.webhooksLimit, alert: false },
  ]

  return (
    <Section title={`Plano ${data.plan.name}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => {
          const percentage = row.limit > 0 ? Math.min(100, (row.used / row.limit) * 100) : 0
          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">{formatNumber(row.used)} de {formatNumber(row.limit)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={row.alert && percentage >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${percentage}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}

export function Settings() {
  const queryClient = useQueryClient()
  const updateUser = useAuthStore((state) => state.updateUser)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [form, setForm] = useState<SettingsResponse | null>(null)
  const [name, setName] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'member' as 'admin' | 'member' })
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [smtpPassword, setSmtpPassword] = useState('')

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.getSettings() })
  const workspaceQuery = useQuery({ queryKey: ['workspace-context'], queryFn: () => organizationsApi.getContext() })

  useEffect(() => {
    const settings = settingsQuery.data?.data?.settings as SettingsResponse | undefined
    if (!settings) return
    setForm(settings)
    setName(settings.profile.name || '')
  }, [settingsQuery.data])

  const workspace = workspaceQuery.data?.data as WorkspaceContextResponse | undefined
  const canManage = form?.workspace.role === 'owner' || form?.workspace.role === 'admin'

  const onError = (fallback: string) => (error: any) => {
    toast.error(error.response?.data?.message || error.response?.data?.error || fallback)
  }

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
    queryClient.invalidateQueries({ queryKey: ['workspace-context'] }),
  ])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => settingsApi.updateSettings(payload as any),
    onSuccess: async () => {
      await refresh()
      toast.success('Salvo')
    },
    onError: onError('Não foi possível salvar'),
  })

  const profileMutation = useMutation({
    mutationFn: () => authApi.updateProfile({ name: name.trim() }),
    onSuccess: (response) => {
      updateUser(response.data.user)
      toast.success('Perfil salvo')
    },
    onError: onError('Não foi possível salvar o perfil'),
  })

  const passwordMutation = useMutation({
    mutationFn: () => authApi.changePassword({ current_password: passwords.current, new_password: passwords.next }),
    onSuccess: () => {
      setPasswords({ current: '', next: '', confirm: '' })
      toast.success('Senha alterada')
    },
    onError: onError('Não foi possível alterar a senha'),
  })

  const inviteMutation = useMutation({
    mutationFn: () => organizationsApi.createInvitation(invite),
    onSuccess: async () => {
      setInvite({ email: '', role: 'member' })
      await refresh()
      toast.success('Convite enviado')
    },
    onError: onError('Não foi possível convidar'),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: number) => organizationsApi.removeMember(membershipId),
    onSuccess: refresh,
    onError: onError('Não foi possível remover'),
  })

  const respondMutation = useMutation({
    mutationFn: ({ token, accept }: { token: string; accept: boolean }) =>
      accept ? organizationsApi.acceptInvitation(token) : organizationsApi.declineInvitation(token),
    onSuccess: refresh,
    onError: onError('Não foi possível responder o convite'),
  })

  if (!form) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const sending = form.account_preferences.sending_settings
  const branding = form.account_preferences.branding_settings
  const smtp = form.account_preferences.smtp_settings

  const setSending = (patch: Partial<SendingSettings>) =>
    setForm({ ...form, account_preferences: { ...form.account_preferences, sending_settings: { ...sending, ...patch } } })
  const setBranding = (patch: Partial<typeof branding>) =>
    setForm({ ...form, account_preferences: { ...form.account_preferences, branding_settings: { ...branding, ...patch } } })
  const setSmtp = (patch: Partial<SmtpSettings>) =>
    setForm({ ...form, account_preferences: { ...form.account_preferences, smtp_settings: { ...smtp, ...patch } } })

  const handleTheme = (theme: Theme) => {
    setTheme(theme)
    saveMutation.mutate({ system_preferences: { ...form.personal_preferences.system_preferences, theme } })
  }

  const handlePassword = (event: React.FormEvent) => {
    event.preventDefault()
    if (passwords.next.length < 8) {
      toast.error('A nova senha precisa ter pelo menos 8 caracteres')
      return
    }
    if (passwords.next !== passwords.confirm) {
      toast.error('As senhas não conferem')
      return
    }
    passwordMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />

      <PlanSection />

      <Section title="Perfil">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={form.profile.email} disabled />
          </div>
        </div>
        <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending || !name.trim()}>
          Salvar
        </Button>
      </Section>

      <Section title="Envio" description="Usado quando o envio não informa o remetente.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="from-name">Nome do remetente</Label>
            <Input
              id="from-name"
              placeholder="Loja da Ana"
              value={sending.default_from_name || ''}
              onChange={(event) => setSending({ default_from_name: event.target.value })}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-email">Email do remetente</Label>
            <Input
              id="from-email"
              placeholder="contato@suaempresa.com"
              value={sending.default_from_email || ''}
              onChange={(event) => setSending({ default_from_email: event.target.value })}
              disabled={!canManage}
            />
          </div>
        </div>
        <div className="space-y-3">
          <ToggleRow label="Saber quando o email é aberto" checked={Boolean(sending.open_tracking)} onChange={(value) => setSending({ open_tracking: value })} disabled={!canManage} />
          <ToggleRow label="Saber quando um link é clicado" checked={Boolean(sending.click_tracking)} onChange={(value) => setSending({ click_tracking: value })} disabled={!canManage} />
          <ToggleRow label="Não enviar para endereços que já falharam" checked={Boolean(sending.suppression_list_enabled)} onChange={(value) => setSending({ suppression_list_enabled: value })} disabled={!canManage} />
        </div>
        <Button onClick={() => saveMutation.mutate({ sending_settings: sending })} disabled={!canManage || saveMutation.isPending}>
          Salvar
        </Button>
      </Section>

      <Section title="Assinatura" description="Aparece no rodapé dos seus emails.">
        <div className="space-y-2">
          <Label htmlFor="company">Nome da empresa</Label>
          <Input id="company" value={branding.company_name || ''} onChange={(event) => setBranding({ company_name: event.target.value })} disabled={!canManage} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="footer">Rodapé</Label>
          <Textarea id="footer" rows={3} value={branding.footer_text || ''} onChange={(event) => setBranding({ footer_text: event.target.value })} disabled={!canManage} />
        </div>
        <Button onClick={() => saveMutation.mutate({ branding_settings: branding })} disabled={!canManage || saveMutation.isPending}>
          Salvar
        </Button>
      </Section>

      <Section title="Equipe" description="Pessoas com acesso a esta conta.">
        {(workspace?.received_invitations || []).map((invitation) => (
          <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
            <span>Convite para <b>{invitation.organizationName}</b> como {roleLabels[invitation.role]}</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => respondMutation.mutate({ token: invitation.token, accept: true })}>Aceitar</Button>
              <Button size="sm" variant="outline" onClick={() => respondMutation.mutate({ token: invitation.token, accept: false })}>Recusar</Button>
            </div>
          </div>
        ))}

        <ul className="divide-y rounded-lg border">
          {(workspace?.members || []).map((member) => (
            <li key={member.membershipId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{member.name || member.email}</div>
                <div className="truncate text-xs text-muted-foreground">{member.email} · {roleLabels[member.role]}</div>
              </div>
              {canManage && member.role !== 'owner' && (
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remover" onClick={() => removeMemberMutation.mutate(member.membershipId)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
          {(workspace?.pending_invitations || []).map((invitation) => (
            <li key={`invite-${invitation.id}`} className="px-3 py-2.5 text-sm text-muted-foreground">
              {invitation.email} · convite pendente
            </li>
          ))}
          {(workspace?.members || []).length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">Só você por enquanto.</li>
          )}
        </ul>

        {canManage && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              if (invite.email.trim()) inviteMutation.mutate()
            }}
          >
            <Input
              type="email"
              placeholder="email@exemplo.com"
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
            />
            <select
              className={selectClassName}
              value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value as 'admin' | 'member' })}
              aria-label="Papel"
            >
              <option value="member">Membro</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" disabled={inviteMutation.isPending}>Convidar</Button>
          </form>
        )}
      </Section>

      <Section title="Aparência">
        <div className="flex flex-wrap gap-2">
          {([['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Automático']] as const).map(([value, label]) => (
            <Button
              key={value}
              variant={form.personal_preferences.system_preferences.theme === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleTheme(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Senha">
        <details>
          <summary className="cursor-pointer text-sm text-primary hover:underline">Alterar senha</summary>
          <form onSubmit={handlePassword} className="mt-4 grid gap-3 sm:max-w-sm">
            <Input type="password" placeholder="Senha atual" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" />
            <Input type="password" placeholder="Nova senha" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" />
            <Input type="password" placeholder="Repita a nova senha" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" />
            <Button type="submit" className="w-fit" disabled={passwordMutation.isPending}>Alterar senha</Button>
          </form>
        </details>
      </Section>

      {canManage && (
        <Section title="Avançado">
          <details>
            <summary className="cursor-pointer text-sm text-primary hover:underline">Usar meu próprio servidor SMTP</summary>
            <div className="mt-4 space-y-4">
              <ToggleRow label="Enviar pelo meu servidor" checked={smtp.use_custom} onChange={(value) => setSmtp({ use_custom: value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Servidor (ex: smtp.gmail.com)" value={smtp.host || ''} onChange={(event) => setSmtp({ host: event.target.value })} />
                <Input placeholder="Porta (ex: 587)" type="number" value={smtp.port ?? ''} onChange={(event) => setSmtp({ port: event.target.value ? Number(event.target.value) : null })} />
                <Input placeholder="Usuário" value={smtp.username || ''} onChange={(event) => setSmtp({ username: event.target.value })} />
                <Input
                  placeholder={smtp.password_configured ? 'Senha (salva)' : 'Senha'}
                  type="password"
                  value={smtpPassword}
                  onChange={(event) => setSmtpPassword(event.target.value)}
                />
              </div>
              <ToggleRow label="Conexão segura (TLS)" checked={smtp.use_tls} onChange={(value) => setSmtp({ use_tls: value })} />
              <Button
                onClick={() => saveMutation.mutate({ smtp_settings: { ...smtp, password: smtpPassword || undefined } })}
                disabled={saveMutation.isPending}
              >
                Salvar
              </Button>
            </div>
          </details>
        </Section>
      )}
    </div>
  )
}
