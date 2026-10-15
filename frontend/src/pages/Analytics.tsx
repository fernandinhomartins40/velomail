import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity,
  ArrowUpRight,
  Eye,
  Globe,
  Mail,
  MousePointer,
  RefreshCw,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react'
import { analyticsApi } from '@/lib/api'
import { getEmailStatusLabel } from '@/lib/emailEngagement'
import { useSettingsStore } from '@/lib/store'
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { veloMailChartColors } from '@/lib/theme'

const chartColors = {
  sent: veloMailChartColors.primary,
  delivered: veloMailChartColors.secondary,
  opened: veloMailChartColors.success,
  clicked: veloMailChartColors.warning,
}

const analyticsRanges: Array<'7d' | '30d' | '90d'> = ['7d', '30d', '90d']

const metricStyles = {
  sent: {
    surface: 'border-border bg-card',
    icon: 'bg-primary/10 text-primary',
    bar: 'from-primary to-primary',
  },
  delivered: {
    surface: 'border-border bg-card',
    icon: 'bg-primary/10 text-primary',
    bar: 'from-primary to-primary',
  },
  opened: {
    surface: 'border-border bg-card',
    icon: 'bg-primary/10 text-primary',
    bar: 'from-primary to-primary',
  },
  clicked: {
    surface: 'border-border bg-card',
    icon: 'bg-primary/10 text-primary',
    bar: 'from-primary to-primary',
  },
  bounced: {
    surface: 'border-border bg-card',
    icon: 'bg-destructive/10 text-destructive',
    bar: 'from-destructive to-destructive',
  },
} as const

const toNumber = (value: unknown) => Number(value || 0)
const clampPercentage = (value: number) => Math.max(0, Math.min(100, value))

const formatChange = (value: number, suffix: '%' | 'pp', invertMeaning = false) => {
  const safeValue = Number.isFinite(value) ? value : 0
  const positive = safeValue >= 0
  const improved = invertMeaning ? !positive : positive
  const label = safeValue === 0 ? 'Estável' : `${positive ? '+' : ''}${safeValue.toFixed(1)} ${suffix}`

  return {
    label,
    className: safeValue === 0
      ? 'vm-status vm-status-neutral'
      : improved
        ? 'vm-status vm-status-success'
        : 'vm-status vm-status-danger',
  }
}

const renderPercentageBar = (value: number, gradient: string) => (
  <div className="h-2 overflow-hidden rounded-full bg-muted">
    <div
      className={cn('h-full rounded-full bg-gradient-to-r transition-all', gradient)}
      style={{ width: `${clampPercentage(value)}%` }}
    />
  </div>
)

export function Analytics() {
  const analyticsDefaultTimeRange = useSettingsStore((state) => state.settings.analyticsDefaultTimeRange)
  const [searchParams] = useSearchParams()
  const [timeRange, setTimeRange] = useState(analyticsDefaultTimeRange)
  const domainId = searchParams.get('domainId') || searchParams.get('domain') || undefined

  useEffect(() => {
    setTimeRange(analyticsDefaultTimeRange)
  }, [analyticsDefaultTimeRange])

  const { data: analyticsResponse, isLoading, refetch: refetchAnalytics, isFetching } = useQuery({
    queryKey: ['analytics', timeRange, domainId],
    queryFn: () => analyticsApi.getAnalytics({ timeRange, domainId }),
  })

  const { data: chartResponse, refetch: refetchChart } = useQuery({
    queryKey: ['analytics', 'chart', timeRange, domainId],
    queryFn: () => analyticsApi.getAnalyticsChart({ timeRange, domainId }),
  })

  const { data: topEmailsResponse, refetch: refetchTopEmails } = useQuery({
    queryKey: ['analytics', 'top-emails', timeRange, domainId],
    queryFn: () => analyticsApi.getTopEmails({ timeRange, domainId }),
  })

  const { data: domainsResponse, refetch: refetchDomains } = useQuery({
    queryKey: ['analytics', 'domains', timeRange, domainId],
    queryFn: () => analyticsApi.getDomains({ timeRange, domainId }),
  })

  const { data: activityResponse, refetch: refetchActivity } = useQuery({
    queryKey: ['analytics', 'recent-activity', timeRange, domainId],
    queryFn: () => analyticsApi.getRecentActivity({ timeRange, domainId }),
  })

  const handleRefresh = async () => {
    await Promise.all([refetchAnalytics(), refetchChart(), refetchTopEmails(), refetchDomains(), refetchActivity()])
  }

  const overview = analyticsResponse?.data || {}
  const chart = chartResponse?.data?.chart || []
  const topEmails = topEmailsResponse?.data?.emails || []
  const topDomains = domainsResponse?.data?.domains || []
  const activities = activityResponse?.data?.activities || []

  const totalSent = toNumber(overview.total_sent)
  const deliveredCount = toNumber(overview.delivered_count)
  const openedCount = toNumber(overview.opened_count)
  const clickedCount = toNumber(overview.clicked_count)
  const bouncedCount = toNumber(overview.bounced_count)
  const uniqueRecipients = toNumber(overview.unique_recipients)
  const deliveryRate = toNumber(overview.delivery_rate)
  const openRate = toNumber(overview.open_rate)
  const clickRate = toNumber(overview.click_rate)
  const bounceRate = toNumber(overview.bounce_rate)

  const latestChartPoint = chart[chart.length - 1]
  const totalChartVolume = chart.reduce((acc: number, row: any) => acc + toNumber(row.sent), 0)

  const cards = [
    {
      key: 'sent',
      title: 'Emails enviados',
      value: formatNumber(totalSent),
      highlight: `${formatNumber(uniqueRecipients)} destinatários únicos`,
      detail: 'Base do funil no período',
      change: formatChange(toNumber(overview.sent_change), '%'),
      icon: Mail,
      progress: 100,
    },
    {
      key: 'delivered',
      title: 'Aceite SMTP',
      value: `${deliveryRate.toFixed(1)}%`,
      highlight: `${formatNumber(deliveredCount)} aceitos pelo servidor`,
      detail: 'Saúde técnica da entrega',
      change: formatChange(toNumber(overview.delivery_change), 'pp'),
      icon: TrendingUp,
      progress: deliveryRate,
    },
    {
      key: 'opened',
      title: 'Abertura',
      value: `${openRate.toFixed(1)}%`,
      highlight: `${formatNumber(openedCount)} aberturas`,
      detail: 'Leitura rastreada do email',
      change: formatChange(toNumber(overview.open_change), 'pp'),
      icon: Eye,
      progress: openRate,
    },
    {
      key: 'clicked',
      title: 'Clique',
      value: `${clickRate.toFixed(1)}%`,
      highlight: `${formatNumber(clickedCount)} cliques`,
      detail: 'Sinal mais forte de interesse',
      change: formatChange(toNumber(overview.click_change), 'pp'),
      icon: MousePointer,
      progress: clickRate,
    },
    {
      key: 'bounced',
      title: 'Bounce',
      value: `${bounceRate.toFixed(1)}%`,
      highlight: `${formatNumber(bouncedCount)} falhas ou rejeições`,
      detail: 'Quanto menor, melhor',
      change: formatChange(toNumber(overview.bounce_change), 'pp', true),
      icon: XCircle,
      progress: bounceRate,
    },
  ] as const

  const funnelSteps = [
    { label: 'Enviados', count: totalSent, percentage: 100, tone: metricStyles.sent.bar },
    { label: 'Aceitos SMTP', count: deliveredCount, percentage: totalSent > 0 ? (deliveredCount / totalSent) * 100 : 0, tone: metricStyles.delivered.bar },
    { label: 'Abertos', count: openedCount, percentage: totalSent > 0 ? (openedCount / totalSent) * 100 : 0, tone: metricStyles.opened.bar },
    { label: 'Clicados', count: clickedCount, percentage: totalSent > 0 ? (clickedCount / totalSent) * 100 : 0, tone: metricStyles.clicked.bar },
  ]

  const formatActivityLabel = (activity: any) => getEmailStatusLabel(activity.status || activity.event_type)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas"
        actions={
          <>
            {analyticsRanges.map((range) => (
              <Button
                key={range}
                size="sm"
                variant={timeRange === range ? 'default' : 'outline'}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => handleRefresh()} aria-label="Atualizar">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Card key={index} className="animate-pulse">
              <CardContent className="space-y-4 p-6">
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="h-8 w-20 rounded bg-muted" />
                <div className="h-2 w-full rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => {
            const Icon = card.icon
            const style = metricStyles[card.key]

            return (
              <Card key={card.key} className={cn('overflow-hidden shadow-sm', style.surface)}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className={cn('rounded-2xl p-3', style.icon)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge className={cn('rounded-full border px-3 py-1', card.change.className)}>
                      {card.change.label}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">{card.title}</div>
                    <div className="text-3xl font-semibold tracking-tight text-foreground">{card.value}</div>
                    <div className="text-sm text-muted-foreground">{card.highlight}</div>
                    <div className="text-xs text-muted-foreground">{card.detail}</div>
                  </div>

                  <div className="space-y-2">
                    {renderPercentageBar(card.progress, style.bar)}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Intensidade visual</span>
                      <span>{clampPercentage(card.progress).toFixed(0)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/35">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-xl">Ritmo do período</CardTitle>
                <CardDescription>Envio, aceite SMTP e engajamento na mesma linha do tempo.</CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border bg-card px-4 py-3">
                  <div className="vm-metric-label">Último dia</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{formatNumber(toNumber(latestChartPoint?.sent))}</div>
                  <div className="text-xs text-muted-foreground">envios registrados</div>
                </div>
                <div className="rounded-xl border bg-card px-4 py-3">
                  <div className="vm-metric-label">Aberturas</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{formatNumber(openedCount)}</div>
                  <div className="text-xs text-muted-foreground">no recorte atual</div>
                </div>
                <div className="rounded-xl border bg-card px-4 py-3">
                  <div className="vm-metric-label">Volume total</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{formatNumber(totalChartVolume)}</div>
                  <div className="text-xs text-muted-foreground">somando todos os dias</div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {/* A legenda usa exatamente as cores das series do grafico. */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Envios', color: chartColors.sent },
                { label: 'Aceite SMTP', color: chartColors.delivered },
                { label: 'Aberturas', color: chartColors.opened },
                { label: 'Cliques', color: chartColors.clicked },
              ].map((serie) => (
                <span key={serie.label} className="vm-status vm-status-neutral">
                  <span className="h-2 w-2 rounded-full" style={{ background: serie.color }} />
                  {serie.label}
                </span>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={chart} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.sent} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={chartColors.sent} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="deliveredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.delivered} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={chartColors.delivered} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.opened} stopOpacity={0.24} />
                    <stop offset="100%" stopColor={chartColors.opened} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="clickedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.clicked} stopOpacity={0.24} />
                    <stop offset="100%" stopColor={chartColors.clicked} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={veloMailChartColors.grid} strokeDasharray="4 4" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: veloMailChartColors.label, fontSize: 12 }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: veloMailChartColors.label, fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: `1px solid ${veloMailChartColors.grid}`, boxShadow: '0 18px 48px rgba(10, 37, 78, 0.14)' }}
                  labelFormatter={(value) => new Date(value).toLocaleDateString('pt-BR')}
                  formatter={(value: number, name: string) => [
                    formatNumber(Number(value || 0)),
                    name === 'sent' ? 'Enviados' : name === 'delivered' ? 'Aceitos SMTP' : name === 'opened' ? 'Abertos' : 'Cliques',
                  ]}
                />
                <Area type="monotone" dataKey="sent" stroke={chartColors.sent} strokeWidth={2.4} fill="url(#sentGradient)" />
                <Area type="monotone" dataKey="delivered" stroke={chartColors.delivered} strokeWidth={2.4} fill="url(#deliveredGradient)" />
                <Area type="monotone" dataKey="opened" stroke={chartColors.opened} strokeWidth={2.4} fill="url(#openedGradient)" />
                <Area type="monotone" dataKey="clicked" stroke={chartColors.clicked} strokeWidth={2.4} fill="url(#clickedGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/35">
            <CardTitle className="text-xl">Funil visual</CardTitle>
            <CardDescription>Mostra a compressão natural do engajamento em cada etapa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {funnelSteps.map((step) => (
              <div key={step.label} className="space-y-2 rounded-xl border bg-muted/45 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{step.label}</div>
                    <div className="text-sm text-muted-foreground">{formatNumber(step.count)} registros</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-foreground">{step.percentage.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">sobre enviados</div>
                  </div>
                </div>
                {renderPercentageBar(step.percentage, step.tone)}
              </div>
            ))}

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-primary">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Leitura operacional</span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Se o aceite SMTP estiver alto e a abertura baixa, o gargalo tende a ser caixa de spam, assunto ou falta de pixel HTML.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/35">
            <CardTitle className="text-xl">Atividade recente</CardTitle>
            <CardDescription>Eventos mais novos, em ordem de impacto visual e tempo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {activities.length === 0 ? (
              <div className="vm-empty-state">
                <Activity className="mx-auto mb-3 h-8 w-8" />
                Sem atividade recente.
              </div>
            ) : (
              activities.slice(0, 8).map((activity: any, index: number) => (
                <div
                  key={activity.id || `${activity.event_type}-${activity.created_at || activity.timestamp}-${index}`}
                  className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                        <span className="font-medium text-foreground">{formatActivityLabel(activity)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {activity.email_subject || activity.subject || activity.email_to || activity.email}
                      </div>
                      <div className="text-xs text-muted-foreground">{activity.email_to || activity.email}</div>
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {formatRelativeTime(activity.created_at || activity.timestamp)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/35">
              <CardTitle className="text-xl">Top emails</CardTitle>
              <CardDescription>Assuntos com maior resposta no período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6">
              {topEmails.length === 0 ? (
                <div className="vm-empty-state">
                  Nenhum email encontrado no período.
                </div>
              ) : (
                topEmails.slice(0, 5).map((email: any) => (
                  <div key={email.id} className="rounded-xl border bg-card p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">{email.subject}</div>
                        <div className="text-xs text-muted-foreground">{formatRelativeTime(email.sent_at)}</div>
                      </div>
                      <span className="vm-status vm-status-info">
                        {Number(email.open_rate || 0).toFixed(1)}% abertura
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>{formatNumber(toNumber(email.sent_count))} enviados</div>
                      <div>{Number(email.click_rate || 0).toFixed(1)}% clique</div>
                      <div>{Number(email.bounce_rate || 0).toFixed(1)}% bounce</div>
                    </div>
                    {renderPercentageBar(toNumber(email.open_rate), metricStyles.opened.bar)}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/35">
              <CardTitle className="text-xl">Top domínios</CardTitle>
              <CardDescription>Leitura rápida de volume e saúde por remetente autenticado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6">
              {topDomains.length === 0 ? (
                <div className="vm-empty-state">
                  <Globe className="mx-auto mb-3 h-8 w-8" />
                  Nenhum domínio com dados no período.
                </div>
              ) : (
                topDomains.slice(0, 5).map((domain: any, index: number) => (
                  <div key={domain.domain_id || `${domain.domain}-${index}`} className="rounded-xl border bg-card p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">{domain.domain}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(toNumber(domain.sent_count || domain.total_emails))} envios</div>
                      </div>
                      <span className="vm-status vm-status-info">
                        {Number(domain.delivery_rate || 0).toFixed(1)}% aceite SMTP
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>{Number(domain.open_rate || 0).toFixed(1)}% abertura</div>
                      <div>{Number(domain.click_rate || 0).toFixed(1)}% clique</div>
                      <div>{Number(domain.bounce_rate || 0).toFixed(1)}% bounce</div>
                    </div>
                    {renderPercentageBar(toNumber(domain.delivery_rate), metricStyles.delivered.bar)}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="flex h-full items-start justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Destinatários únicos</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{formatNumber(uniqueRecipients)}</div>
              <div className="mt-1 text-xs text-muted-foreground">Tamanho real da audiência atingida</div>
            </div>
            <Users className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full items-start justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Leitura do momento</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {latestChartPoint ? formatNumber(toNumber(latestChartPoint.opened)) : '0'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">aberturas no último ponto do gráfico</div>
            </div>
            <Activity className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full items-start justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Próximo foco</div>
              <div className="mt-1 text-lg font-semibold text-foreground">
                {deliveryRate >= 90 && openRate < 20 ? 'Melhorar abertura' : bounceRate > 5 ? 'Reduzir bounce' : 'Escalar volume com segurança'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Recomendação visual baseada no funil atual</div>
            </div>
            <ArrowUpRight className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
