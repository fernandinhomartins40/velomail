import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Inbox, Loader2, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page'
import { getEmailStatusLabel } from '@/lib/emailEngagement'
import { emailApi } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { useSmartPolling } from '@/hooks/useSmartPolling'
import { useDebounce } from '@/hooks/useDebounce'
import { useSettingsStore } from '@/lib/store'

interface Email {
  id: number
  to_email: string
  subject: string
  status: string
  bounce_reason?: string
  sent_at: string
  created_at: string
}

const statusFilters = [
  { value: 'all', label: 'Todos' },
  { value: 'delivered', label: 'Entregues' },
  { value: 'opened', label: 'Abertos' },
  { value: 'bounced', label: 'Bounce' },
  { value: 'failed', label: 'Falharam' },
]

const dateFilters = [
  { value: 'all', label: 'Qualquer data' },
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Últimos 7 dias' },
  { value: 'month', label: 'Último mês' },
]

const statusTone = (status: string) => {
  if (['bounced', 'failed', 'rejected'].includes(status)) return 'vm-status-danger'
  if (['opened', 'clicked'].includes(status)) return 'vm-status-info'
  if (status === 'delivered') return 'vm-status-success'
  return 'vm-status-neutral'
}

const selectClassName = 'h-10 rounded-lg border border-input bg-background px-3 text-sm'

export function EmailList() {
  const navigate = useNavigate()
  const emailsPerPage = useSettingsStore((state) => state.settings.emailsPerPage)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 300)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, dateFilter])

  const { data, isLoading } = useSmartPolling({
    queryKey: ['emails', debouncedSearch, statusFilter, dateFilter, String(page), String(emailsPerPage)],
    queryFn: () => emailApi.getEmails({
      search: debouncedSearch || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      date_filter: dateFilter === 'all' ? undefined : dateFilter,
      page,
      limit: emailsPerPage,
      sort: 'created_at',
      order: 'desc',
    }),
    baseInterval: 5000,
    maxInterval: 30000,
  })

  const emails: Email[] = (data as any)?.data?.emails || []
  const pagination = (data as any)?.data?.pagination || { page: 1, pages: 1, total: 0 }
  const isFiltered = Boolean(debouncedSearch) || statusFilter !== 'all' || dateFilter !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Envios"
        actions={
          <Button onClick={() => navigate('/app/emails/send')}>
            <Send className="mr-2 h-4 w-4" />
            Enviar email
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por destinatário ou assunto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <select className={selectClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status">
          {statusFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className={selectClassName} value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Data">
          {dateFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              {isFiltered ? 'Nenhum email com esses filtros.' : 'Você ainda não enviou nenhum email.'}
            </p>
            {!isFiltered && (
              <Button onClick={() => navigate('/app/emails/send')}>Enviar o primeiro</Button>
            )}
          </div>
        ) : (
          <ul className="divide-y">
            {emails.map((email) => (
              <li key={email.id}>
                <Link
                  to={`/app/emails/${email.id}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{email.to_email}</div>
                    <div className="truncate text-sm text-muted-foreground">{email.subject}</div>
                  </div>
                  <span className={cn('vm-status shrink-0', statusTone(email.status))}>
                    {getEmailStatusLabel(email.status)}
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
                    {formatRelativeTime(email.sent_at || email.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pagination.pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3 text-sm">
            <span className="text-muted-foreground">Página {pagination.page} de {pagination.pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= pagination.pages}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
