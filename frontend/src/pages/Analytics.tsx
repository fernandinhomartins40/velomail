import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { analyticsApi } from '@/lib/api'
import { useSettingsStore } from '@/lib/store'
import { cn, formatNumber } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page'
import { veloMailChartColors } from '@/lib/theme'

const ranges: Array<{ value: '7d' | '30d' | '90d'; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
]

const series = [
  { key: 'sent', label: 'Enviados', color: veloMailChartColors.primary },
  { key: 'opened', label: 'Abertos', color: veloMailChartColors.success },
]

const toNumber = (value: unknown) => Number(value || 0)
const percent = (value: number) => `${value.toFixed(1)}%`

export function Analytics() {
  const defaultRange = useSettingsStore((state) => state.settings.analyticsDefaultTimeRange)
  const [searchParams] = useSearchParams()
  const [timeRange, setTimeRange] = useState(defaultRange)
  const domainId = searchParams.get('domainId') || undefined

  useEffect(() => {
    setTimeRange(defaultRange)
  }, [defaultRange])

  const { data: overviewResponse, isLoading } = useQuery({
    queryKey: ['analytics', timeRange, domainId],
    queryFn: () => analyticsApi.getAnalytics({ timeRange, domainId }),
  })
  const { data: chartResponse } = useQuery({
    queryKey: ['analytics', 'chart', timeRange, domainId],
    queryFn: () => analyticsApi.getAnalyticsChart({ timeRange, domainId }),
  })
  const { data: domainsResponse } = useQuery({
    queryKey: ['analytics', 'domains', timeRange, domainId],
    queryFn: () => analyticsApi.getDomains({ timeRange, domainId }),
  })

  const overview = overviewResponse?.data || {}
  const chart = chartResponse?.data?.chart || []
  const domains: any[] = domainsResponse?.data?.domains || []

  const metrics = [
    { label: 'Enviados', value: formatNumber(toNumber(overview.total_sent)) },
    { label: 'Entregues', value: percent(toNumber(overview.delivery_rate)), detail: `${formatNumber(toNumber(overview.delivered_count))} emails` },
    { label: 'Abertos', value: percent(toNumber(overview.open_rate)), detail: `${formatNumber(toNumber(overview.opened_count))} emails` },
    {
      label: 'Bounce',
      value: percent(toNumber(overview.bounce_rate)),
      detail: `${formatNumber(toNumber(overview.bounced_count))} emails`,
      alert: toNumber(overview.bounce_rate) > 5,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas"
        actions={
          <div className="flex rounded-lg border p-0.5">
            {ranges.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => setTimeRange(range.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  timeRange === range.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="vm-metric-card">
            <div className="text-sm text-muted-foreground">{metric.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', metric.alert && 'text-destructive')}>
              {isLoading ? '—' : metric.value}
            </div>
            {metric.detail && <div className="text-xs text-muted-foreground">{metric.detail}</div>}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold">Por dia</h2>
            <div className="flex gap-4 text-xs text-muted-foreground">
              {series.map((item) => (
                <span key={item.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {chart.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Sem envios neste período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chart} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke={veloMailChartColors.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: veloMailChartColors.label, fontSize: 12 }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: veloMailChartColors.label, fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: `1px solid ${veloMailChartColors.grid}` }}
                  labelFormatter={(value) => new Date(value).toLocaleDateString('pt-BR')}
                  formatter={(value: number, name: string) => [formatNumber(Number(value || 0)), series.find((item) => item.key === name)?.label || name]}
                />
                {series.map((item) => (
                  <Line key={item.key} type="monotone" dataKey={item.key} stroke={item.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {domains.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b px-5 py-3 font-semibold">Por domínio</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Domínio</th>
                  <th className="px-5 py-2 text-right font-medium">Enviados</th>
                  <th className="px-5 py-2 text-right font-medium">Entregues</th>
                  <th className="px-5 py-2 text-right font-medium">Abertos</th>
                  <th className="px-5 py-2 text-right font-medium">Bounce</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {domains.map((domain) => (
                  <tr key={domain.domain_id || domain.domain}>
                    <td className="px-5 py-2.5 font-medium">{domain.domain}</td>
                    <td className="px-5 py-2.5 text-right">{formatNumber(toNumber(domain.sent_count))}</td>
                    <td className="px-5 py-2.5 text-right">{percent(toNumber(domain.delivery_rate))}</td>
                    <td className="px-5 py-2.5 text-right">{percent(toNumber(domain.open_rate))}</td>
                    <td className="px-5 py-2.5 text-right">{percent(toNumber(domain.bounce_rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
