import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowRight, Check, Loader2, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page'
import { AiSetupDialog } from '@/components/ai/AiSetupDialog'
import { analyticsApi, api } from '@/lib/api'
import { getEmailStatusLabel } from '@/lib/emailEngagement'
import { useAuthStore } from '@/lib/store'
import { cn, formatNumber } from '@/lib/utils'
import { useSmartPolling } from '@/hooks/useSmartPolling'
import { useAccountUsage, type AccountUsage } from '@/hooks/useAccountUsage'

interface DashboardStats {
  totalEmails: number
  deliveryRate: number
  openRate: number
  bounceRate: number
}

interface RecentActivity {
  email: string
  status: string
  timestamp: string
}

const buildSteps = (onboarding: AccountUsage['onboarding']) => [
  { label: 'Adicione seu domínio', done: onboarding.domain_added, href: '/app/domains?mode=setup' },
  { label: 'Configure o DNS', done: onboarding.domain_verified, href: '/app/domains?mode=setup' },
  { label: 'Crie sua chave de API', done: onboarding.api_key_created, href: '/app/api-keys' },
  { label: 'Envie o primeiro email', done: onboarding.first_email_sent, href: '/app/emails/send' },
]

function GettingStarted({ onboarding, onOpenAi }: { onboarding: AccountUsage['onboarding']; onOpenAi: () => void }) {
  const steps = buildSteps(onboarding)
  const doneCount = steps.filter((step) => step.done).length
  const nextIndex = steps.findIndex((step) => !step.done)

  if (nextIndex === -1) {
    return null
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold">Primeiros passos</h2>
          <span className="text-sm text-muted-foreground">{doneCount} de {steps.length}</span>
        </div>

        <ol className="space-y-1">
          {steps.map((step, index) => (
            <li key={step.label}>
              <Link
                to={step.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent',
                  index === nextIndex && 'bg-primary/5 font-medium'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                    step.done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
                  )}
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className={cn('flex-1', step.done && 'text-muted-foreground line-through')}>{step.label}</span>
                {index === nextIndex && <ArrowRight className="h-4 w-4 text-primary" />}
              </Link>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onOpenAi}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Sparkles className="h-4 w-4" />
          Prefere que a IA faça isso por você?
        </button>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [aiOpen, setAiOpen] = useState(searchParams.get('ia') === '1')
  const { data: account } = useAccountUsage()

  const { data: stats, isLoading } = useSmartPolling({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => (await analyticsApi.getOverview()).data.stats,
    baseInterval: 30000,
    maxInterval: 300000,
  })

  const { data: activity } = useSmartPolling({
    queryKey: ['recent-activity'],
    queryFn: async (): Promise<RecentActivity[]> => {
      try {
        return (await api.get('/analytics/recent-activity')).data.activities || []
      } catch {
        return []
      }
    },
    baseInterval: 60000,
    maxInterval: 600000,
  })

  const handleAiOpenChange = (open: boolean) => {
    setAiOpen(open)
    if (!open && searchParams.has('ia')) {
      searchParams.delete('ia')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const safeStats: DashboardStats = stats || { totalEmails: 0, deliveryRate: 0, openRate: 0, bounceRate: 0 }
  const recentActivity = (activity as RecentActivity[] | undefined) || []
  const firstName = user?.name?.split(' ')[0]

  const metrics = [
    { label: 'Enviados', value: formatNumber(safeStats.totalEmails) },
    { label: 'Entregues', value: `${safeStats.deliveryRate.toFixed(1)}%` },
    { label: 'Abertos', value: `${safeStats.openRate.toFixed(1)}%` },
    { label: 'Bounce', value: `${safeStats.bounceRate.toFixed(1)}%`, alert: safeStats.bounceRate > 5 },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Olá, ${firstName}` : 'Início'}
        actions={
          <>
            <Button variant="outline" onClick={() => setAiOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Configurar com IA
            </Button>
            <Button onClick={() => navigate('/app/emails/send')}>
              <Send className="mr-2 h-4 w-4" />
              Enviar email
            </Button>
          </>
        }
      />

      {account?.plan.sending_blocked && (
        <div className="vm-status vm-status-danger w-full justify-center rounded-lg py-2 text-sm">
          O envio desta conta está pausado. Fale com o suporte.
        </div>
      )}

      {account && <GettingStarted onboarding={account.onboarding} onOpenAi={() => setAiOpen(true)} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="vm-metric-card">
            <div className="text-sm text-muted-foreground">{metric.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', metric.alert && 'text-destructive')}>
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : metric.value}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-semibold">Atividade recente</h2>
            <div className="flex gap-3 text-sm">
              <Link to="/app/analytics" className="text-muted-foreground hover:text-foreground">Métricas</Link>
              <Link to="/app/emails" className="text-primary hover:underline">Ver todos</Link>
            </div>
          </div>

          {recentActivity.length > 0 ? (
            <ul className="divide-y">
              {recentActivity.slice(0, 6).map((item, index) => (
                <li key={`${item.email}-${item.timestamp}-${index}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{item.email}</span>
                  <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                    <span>{getEmailStatusLabel(item.status)}</span>
                    <span className="hidden sm:inline">
                      {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: ptBR })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum envio ainda.</p>
          )}
        </CardContent>
      </Card>

      <AiSetupDialog open={aiOpen} onOpenChange={handleAiOpenChange} />
    </div>
  )
}
