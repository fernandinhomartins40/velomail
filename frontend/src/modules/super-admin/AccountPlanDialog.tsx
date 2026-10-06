import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { superAdminApi } from '@/lib/api'
import type { AccountPlanDetails, AccountRow, PlanLimitKey, PlanRow, SubscriptionStatus } from './types'
import { formatNumber } from './utils'

const LIMITS: { key: PlanLimitKey; planColumn: keyof PlanRow; label: string }[] = [
  { key: 'emailsPerMinute', planColumn: 'emails_per_minute', label: 'Emails por minuto' },
  { key: 'emailsPerHour', planColumn: 'emails_per_hour', label: 'Emails por hora' },
  { key: 'emailsPerDay', planColumn: 'emails_per_day', label: 'Emails por dia' },
  { key: 'emailsPerMonth', planColumn: 'emails_per_month', label: 'Emails por mês' },
  { key: 'domainsLimit', planColumn: 'domains_limit', label: 'Domínios' },
  { key: 'webhooksLimit', planColumn: 'webhooks_limit', label: 'Webhooks ativos' }
]

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Ativa',
  trialing: 'Em teste',
  past_due: 'Pagamento em atraso (mantém o plano)',
  canceled: 'Cancelada (volta ao plano padrão)'
}

const SOURCE_LABELS: Record<AccountPlanDetails['plan']['source'], string> = {
  subscription: 'atribuído pelo super admin',
  legacy: 'plano legado',
  default: 'plano padrão'
}

const emptyOverrides = Object.fromEntries(LIMITS.map(({ key }) => [key, ''])) as Record<PlanLimitKey, string>

const selectClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

interface AccountPlanDialogProps {
  account: AccountRow | null
  onClose: () => void
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{formatNumber(used)} / {formatNumber(limit)}</span>
      </div>
      <Progress value={percent} className="h-2" aria-label={label} />
    </div>
  )
}

export function AccountPlanDialog({ account, onClose }: AccountPlanDialogProps) {
  const queryClient = useQueryClient()
  const accountId = account?.id ?? null

  const [planSlug, setPlanSlug] = useState('')
  const [status, setStatus] = useState<SubscriptionStatus>('active')
  const [expiresAt, setExpiresAt] = useState('')
  const [overrides, setOverrides] = useState(emptyOverrides)
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')

  const plansQuery = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => ((await superAdminApi.getPlans()).data.data.plans || []) as PlanRow[],
    enabled: accountId !== null
  })

  const detailsQuery = useQuery({
    queryKey: ['super-admin', 'account', accountId],
    queryFn: async () => (await superAdminApi.getAccount(accountId!)).data.data as AccountPlanDetails,
    enabled: accountId !== null
  })

  const details = detailsQuery.data

  useEffect(() => {
    if (!details) return
    const overridden = new Set(details.plan.overridden_limits)
    setPlanSlug(details.plan.slug)
    setStatus(
      details.plan.status && details.plan.status in STATUS_LABELS
        ? details.plan.status as SubscriptionStatus
        : 'active'
    )
    setExpiresAt(details.plan.expires_at ? String(details.plan.expires_at).slice(0, 10) : '')
    setOverrides(Object.fromEntries(
      LIMITS.map(({ key }) => [key, overridden.has(key) ? String(details.plan.limits[key]) : ''])
    ) as Record<PlanLimitKey, string>)
    setNotes(details.account.plan_notes || '')
    setReason('')
  }, [details])

  const plans = plansQuery.data || []
  const selectedPlan = plans.find((plan) => plan.slug === planSlug)

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error('Selecione uma conta')

      const overridePayload = Object.fromEntries(LIMITS.map(({ key, label }) => {
        const raw = overrides[key].trim()
        if (raw === '') return [key, null]
        const value = Number(raw)
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`${label}: informe um número inteiro ou deixe em branco`)
        }
        return [key, value]
      }))

      await superAdminApi.updateAccountPlan(accountId, {
        plan_name: planSlug,
        status,
        // Fim do dia escolhido, no fuso do navegador.
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        overrides: overridePayload,
        notes: notes.trim() || null,
        reason: reason.trim() || 'Ajuste de plano via painel super admin'
      })
    },
    onSuccess: async () => {
      toast.success('Plano da conta atualizado')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'account', accountId] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit'] })
      ])
      onClose()
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || error?.message || 'Falha ao atualizar plano')
    }
  })

  const isLoading = plansQuery.isLoading || detailsQuery.isLoading
  const hasError = plansQuery.isError || detailsQuery.isError

  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plano e limites</DialogTitle>
          <DialogDescription>
            {account ? `#${account.id} · ${account.email}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando plano da conta...
          </div>
        )}

        {hasError && !isLoading && (
          <p className="py-6 text-sm text-destructive">Não foi possível carregar os dados desta conta.</p>
        )}

        {details && !isLoading && !hasError && (
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              saveMutation.mutate()
            }}
          >
            <section className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Em vigor: {details.plan.name}</span>
                <Badge variant="outline">{SOURCE_LABELS[details.plan.source]}</Badge>
                {details.plan.is_suspended && <Badge variant="destructive">Conta suspensa</Badge>}
                {details.plan.sending_blocked && <Badge variant="destructive">Envio bloqueado</Badge>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <UsageBar label="Emails na última hora" used={details.usage.emailsLastHour} limit={details.plan.limits.emailsPerHour} />
                <UsageBar label="Emails hoje" used={details.usage.emailsToday} limit={details.plan.limits.emailsPerDay} />
                <UsageBar label="Emails no mês" used={details.usage.emailsThisMonth} limit={details.plan.limits.emailsPerMonth} />
                <UsageBar label="Domínios" used={details.usage.domains} limit={details.plan.limits.domainsLimit} />
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="account-plan">Plano</Label>
                <select
                  id="account-plan"
                  required
                  value={planSlug}
                  onChange={(event) => setPlanSlug(event.target.value)}
                  className={selectClassName}
                >
                  {plans.filter((plan) => plan.is_active || plan.slug === planSlug).map((plan) => (
                    <option key={plan.slug} value={plan.slug}>
                      {plan.name}{plan.is_active ? '' : ' (inativo)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-plan-status">Situação</Label>
                <select
                  id="account-plan-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as SubscriptionStatus)}
                  className={selectClassName}
                >
                  {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((value) => (
                    <option key={value} value={value}>{STATUS_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-plan-expires">Válido até (opcional)</Label>
                <Input
                  id="account-plan-expires"
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
            </div>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-medium">Limites personalizados</h3>
                <p className="text-xs text-muted-foreground">
                  Deixe em branco para usar o limite do plano. Após a data de validade a conta volta ao plano padrão.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {LIMITS.map(({ key, planColumn, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`override-${key}`}>{label}</Label>
                    <Input
                      id={`override-${key}`}
                      type="number"
                      min={0}
                      step={1}
                      value={overrides[key]}
                      placeholder={selectedPlan ? `Plano: ${formatNumber(Number(selectedPlan[planColumn]))}` : ''}
                      onChange={(event) => setOverrides((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="account-plan-notes">Observações internas</Label>
                <Input
                  id="account-plan-notes"
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ex.: contrato anual negociado"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-plan-reason">Motivo (vai para a auditoria)</Label>
                <Input
                  id="account-plan-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending || !planSlug}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar plano da conta
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
