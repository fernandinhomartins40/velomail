import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page'
import { getEmailStatusLabel, isEmailClicked, isEmailOpened } from '@/lib/emailEngagement'
import { emailApi } from '@/lib/api'
import { formatDate, formatRelativeTime, getStatusColor } from '@/lib/utils'
import { Search, Filter, RefreshCw, Send, Eye, MousePointer, AlertTriangle, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSmartPolling } from '@/hooks/useSmartPolling'
import { useDebounce } from '@/hooks/useDebounce'
import { useSettingsStore } from '@/lib/store'

interface Email {
  id: number
  from_email: string
  to_email: string
  subject: string
  status: string
  reply_to?: string
  template_id?: string | number
  variables?: Record<string, string> | string
  sent_at: string
  delivered_at?: string
  bounce_reason?: string
  created_at: string
  tracking_enabled: boolean
}

export function EmailList() {
  const navigate = useNavigate()
  const emailsPerPage = useSettingsStore((state) => state.settings.emailsPerPage)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [domainFilter, setDomainFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedEmails, setSelectedEmails] = useState<number[]>([])
  const queryClient = useQueryClient()

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(search, 300)

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, dateFilter, domainFilter])

  // Smart polling for email list with all filters in query key
  const {
    data,
    isLoading,
    error,
    refetch,
    currentInterval,
    pausePolling,
    resumePolling
  } = useSmartPolling({
    queryKey: [
      'emails',
      debouncedSearch,
      statusFilter,
      dateFilter,
      domainFilter,
      page.toString(),
      emailsPerPage.toString()
    ],
    queryFn: () => emailApi.getEmails({
      search: debouncedSearch || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      date_filter: dateFilter === 'all' ? undefined : dateFilter,
      domain_filter: domainFilter === 'all' ? undefined : domainFilter,
      page,
      limit: emailsPerPage,
      sort: 'created_at',
      order: 'desc'
    }),
    baseInterval: 5000, // 5 seconds
    maxInterval: 30000, // 30 seconds
    onError: (error) => {
      console.error('Error fetching emails:', error)
      toast.error('Erro ao buscar emails')
    }
  })

  const emails = (data as any)?.data?.emails || []
  const stats = (data as any)?.data?.stats || { total: 0, delivered: 0, opened: 0, clicked: 0 }
  const pagination = (data as any)?.data?.pagination || { page: 1, pages: 1, total: 0 }

  const handleRefresh = () => {
    toast.promise(
      refetch(),
      {
        loading: 'Atualizando emails...',
        success: 'Emails atualizados!',
        error: 'Erro ao atualizar emails'
      }
    )
  }

  const handleFullRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['emails'] })
    toast.success('Cache limpo e dados atualizados!')
  }

  const handleExportSelected = async () => {
    const selected = emails.filter((email: Email) => selectedEmails.includes(email.id))

    if (selected.length === 0) {
      toast.error('Selecione pelo menos um email para exportar')
      return
    }

    const csvRows = [
      ['id', 'from_email', 'to_email', 'subject', 'status', 'created_at', 'sent_at'],
      ...selected.map((email: Email) => [
        String(email.id),
        email.from_email,
        email.to_email,
        `"${(email.subject || '').replace(/"/g, '""')}"`,
        email.status,
        email.created_at || '',
        email.sent_at || '',
      ]),
    ]

    const blob = new Blob([csvRows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'emails-selecionados.csv'
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Exportacao concluida')
  }

  const parseVariables = (variables: Email['variables']) => {
    if (!variables) {
      return undefined
    }

    if (typeof variables === 'string') {
      try {
        return JSON.parse(variables)
      } catch {
        return undefined
      }
    }

    return variables
  }

  const resendEmails = async (emailIds: number[]) => {
    const failedIds = emails
      .filter((email: Email) => emailIds.includes(email.id) && email.status === 'failed')
      .map((email: Email) => email.id)

    if (failedIds.length === 0) {
      toast.error('Nenhum email falhado selecionado para reenvio')
      return
    }

    await toast.promise(
      (async () => {
        for (const emailId of failedIds) {
          const detailResponse = await emailApi.getEmail(emailId)
          const email = detailResponse.data.email

          await emailApi.send({
            from: email.from_email,
            to: email.to_email,
            subject: email.subject,
            html: email.html_content || undefined,
            text: email.text_content || undefined,
            reply_to: email.reply_to || undefined,
            template_id: email.template_id || undefined,
            variables: parseVariables(email.variables),
            tracking_enabled: email.tracking_enabled,
          })
        }

        await refetch()
        setSelectedEmails([])
      })(),
      {
        loading: 'Reenviando emails falhados...',
        success: 'Emails reenviados',
        error: 'Falha ao reenviar emails',
      }
    )
  }

  const handleClearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setDateFilter('all')
    setDomainFilter('all')
    setSelectedEmails([])
    setPage(1)
    toast.success('Filtros limpos!')
  }

  const isFiltered = search !== '' || statusFilter !== 'all' || dateFilter !== 'all' || domainFilter !== 'all'

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <RefreshCw className="h-4 w-4 text-[hsl(var(--warning))]" />
      case 'sent': return <Send className="h-4 w-4 text-primary" />
      case 'delivered': return <CheckCircle className="h-4 w-4 text-[hsl(var(--success))]" />
      case 'opened': return <Eye className="h-4 w-4 text-primary" />
      case 'clicked': return <MousePointer className="h-4 w-4 text-primary" />
      case 'bounced': return <AlertTriangle className="h-4 w-4 text-destructive" />
      case 'failed': return <AlertTriangle className="h-4 w-4 text-destructive" />
      default: return <div className="h-4 w-4 rounded-full bg-muted-foreground/40" />
    }
  }

  const getStatusBadge = (email: Email) => {
    if (isEmailClicked(email.status)) {
      return <span className="vm-status vm-status-info">Clicado</span>
    }
    if (isEmailOpened(email.status)) {
      return <span className="vm-status vm-status-info">Aberto</span>
    }
    if (email.bounce_reason) {
      return <Badge variant="destructive">Bounce</Badge>
    }
    
    return (
      <span className={getStatusColor(email.status)}>
        {getEmailStatusLabel(email.status)}
      </span>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Envios" />
        
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Erro ao carregar emails</h3>
              <p className="text-muted-foreground mb-4">
                Não foi possível carregar a lista de emails. Tente novamente.
              </p>
              <Button onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Emails</h1>
          <p className="text-muted-foreground">
            {stats.total} emails • {stats.delivered} aceitos pelo servidor
          </p>
        </div>
        
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button onClick={() => navigate('/app/emails/send')}>
            <Send className="h-4 w-4 mr-2" />
            Novo Email
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Send className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-5 w-5 text-[hsl(var(--success))]" />
              <div>
                <p className="text-sm text-muted-foreground">Aceitos SMTP</p>
                <p className="text-2xl font-bold">{stats.delivered}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Abertos</p>
                <p className="text-2xl font-bold">{stats.opened}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MousePointer className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Clicados</p>
                <p className="text-2xl font-bold">{stats.clicked}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtros
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              {isFiltered && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  <Filter className="h-4 w-4 mr-1" />
                  Limpar filtros
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleFullRefresh}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Limpar cache
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Buscar por email, assunto, conteúdo..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                  {search !== debouncedSearch && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                {isFiltered && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Filtros ativos • Mostrando {stats.total} de {pagination.total} emails
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select 
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="all">Todas as datas</option>
                  <option value="today">Hoje</option>
                  <option value="week">Última semana</option>
                  <option value="month">Último mês</option>
                  <option value="3months">Últimos 3 meses</option>
                </select>
                
                <select
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm sm:min-w-[140px]"
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                >
                  <option value="all">Todos os domínios</option>
                  <option value="gmail.com">Gmail</option>
                  <option value="outlook.com">Outlook</option>
                  <option value="hotmail.com">Hotmail</option>
                  <option value="yahoo.com">Yahoo</option>
                  <option value="live.com">Live</option>
                  <option value="icloud.com">iCloud</option>
                  <option value="uol.com.br">UOL</option>
                  <option value="bol.com.br">BOL</option>
                  <option value="terra.com.br">Terra</option>
                  <option value="ig.com.br">IG</option>
                </select>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {['all', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'].map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' ? 'Todos' :
                   status === 'sent' ? 'Enviados' :
                   status === 'delivered' ? 'Aceitos SMTP' :
                   status === 'opened' ? 'Abertos' :
                   status === 'clicked' ? 'Clicados' :
                   status === 'bounced' ? 'Bounces' :
                   status === 'failed' ? 'Falharam' :
                   status}
                </Button>
              ))}
            </div>
            
            {/* Ações em lote */}
            {selectedEmails.length > 0 && (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-primary">
                  {selectedEmails.length} email(s) selecionado(s)
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => resendEmails(selectedEmails)}>
                    Reenviar falhados
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportSelected}>
                    Exportar dados
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setSelectedEmails([])}
                  >
                    Limpar seleção
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={selectedEmails.length === emails.length && emails.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedEmails(emails.map((email: Email) => email.id))
                    } else {
                      setSelectedEmails([])
                    }
                  }}
                />
              </TableHead>
              <TableHead className="w-12">Status</TableHead>
              <TableHead>Para</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>De</TableHead>
              <TableHead>Enviado</TableHead>
              <TableHead>Engajamento</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-4 w-4 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-48 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-24 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded animate-pulse" /></TableCell>
                </TableRow>
              ))
            ) : emails.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center">
                    <Send className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">Nenhum email encontrado</h3>
                    <p className="text-muted-foreground mb-4">
                      {search || statusFilter !== 'all'
                        ? 'Tente ajustar os filtros ou fazer uma nova busca.'
                        : 'Você ainda não enviou nenhum email. Que tal começar agora?'
                      }
                    </p>
                    <Button onClick={() => navigate('/app/emails/send')}>
                      <Send className="h-4 w-4 mr-2" />
                      Enviar primeiro email
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              emails.map((email: Email) => (
                <TableRow key={email.id} className={selectedEmails.includes(email.id) ? 'bg-primary/5' : ''}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedEmails.includes(email.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEmails([...selectedEmails, email.id])
                        } else {
                          setSelectedEmails(selectedEmails.filter(id => id !== email.id))
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(email.status)}
                      {getStatusBadge(email)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{email.to_email}</div>
                    <div className="text-xs text-muted-foreground">
                      @{email.to_email.split('@')[1]}
                    </div>
                    {email.bounce_reason && (
                      <div className="text-sm text-destructive">{email.bounce_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium truncate max-w-[200px]" title={email.subject}>
                      {email.subject}
                    </div>
                    <div className="text-sm text-muted-foreground">ID: {email.id}</div>
                  </TableCell>
                  <TableCell>
                    <div className="truncate max-w-[150px]" title={email.from_email}>
                      {email.from_email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {formatRelativeTime(email.sent_at || email.created_at)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(email.sent_at || email.created_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {isEmailOpened(email.status) ? (
                        <span className="text-[hsl(var(--success))]">✓ Aberto</span>
                      ) : email.sent_at || email.delivered_at ? (
                        <span className="text-muted-foreground">Não aberto</span>
                      ) : (
                        <span className="text-[hsl(var(--warning))]">Pendente</span>
                      )}
                      {isEmailClicked(email.status) && (
                        <div className="text-primary">✓ Clicado</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => navigate(`/app/emails/${email.id}`)}
                      >
                        Ver detalhes
                      </Button>
                      {email.status === 'failed' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-primary"
                          onClick={() => resendEmails([email.id])}
                        >
                          Reenviar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex flex-col gap-4 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:gap-4">
              <span>Página {pagination.page} de {pagination.pages} • {pagination.total} emails</span>
              {selectedEmails.length > 0 && (
                <span className="text-primary">{selectedEmails.length} selecionados</span>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(1)}
                disabled={page <= 1}
              >
                Primeira
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                Anterior
              </Button>
              
              {/* Paginação inteligente */}
              {(() => {
                const totalPages = pagination.pages
                const currentPage = page
                const pages = []
                
                if (totalPages <= 7) {
                  for (let i = 1; i <= totalPages; i++) {
                    pages.push(i)
                  }
                } else {
                  if (currentPage <= 4) {
                    pages.push(1, 2, 3, 4, 5, '...', totalPages)
                  } else if (currentPage >= totalPages - 3) {
                    pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
                  } else {
                    pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
                  }
                }
                
                return pages.map((pageNum, i) => {
                  if (pageNum === '...') {
                    return <span key={i} className="px-2">...</span>
                  }
                  
                  return (
                    <Button
                      key={pageNum}
                      variant={page === pageNum ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(pageNum as number)}
                    >
                      {pageNum}
                    </Button>
                  )
                })
              })()}
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= pagination.pages}
              >
                Próxima
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(pagination.pages)}
                disabled={page >= pagination.pages}
              >
                Última
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
