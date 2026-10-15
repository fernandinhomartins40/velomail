import React, { useState } from 'react'
import { AlertCircle, Globe, Loader2, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DropdownMenuItem, RowActions } from '../ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { DomainStatus } from '../../hooks/useDomainSetup'

interface DomainListProps {
  domains: DomainStatus[]
  loading: boolean
  error: string | null
  onReload: () => Promise<void> | void
  onRemoveDomain: (domainId: number) => Promise<boolean>
  onRefreshDomain: (domainId: number) => Promise<void>
  onAddDomain?: () => void
  onEditDomain?: (domainId: number) => void
}

const statusInfo = (status: DomainStatus['status']) => {
  switch (status) {
    case 'verified':
      return { label: 'Pronto para enviar', tone: 'vm-status-success' }
    case 'failed':
      return { label: 'Com problema', tone: 'vm-status-danger' }
    default:
      return { label: 'Aguardando DNS', tone: 'vm-status-warning' }
  }
}

export const DomainList: React.FC<DomainListProps> = ({
  domains,
  loading,
  error,
  onReload,
  onRemoveDomain,
  onRefreshDomain,
  onAddDomain,
  onEditDomain,
}) => {
  const [domainToDelete, setDomainToDelete] = useState<DomainStatus | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)

  const handleRefresh = async (domainId: number) => {
    setRefreshingId(domainId)
    try {
      await onRefreshDomain(domainId)
      toast.success('Status atualizado')
    } catch {
      toast.error('Não foi possível verificar agora')
    } finally {
      setRefreshingId(null)
    }
  }

  const handleDelete = async () => {
    if (!domainToDelete) return
    await onRemoveDomain(domainToDelete.id)
    setDomainToDelete(null)
  }

  if (loading && domains.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && domains.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={onReload}>Tentar de novo</Button>
      </Card>
    )
  }

  if (domains.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <Globe className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Nenhum domínio ainda.</p>
        {onAddDomain && <Button onClick={onAddDomain}>Adicionar domínio</Button>}
      </Card>
    )
  }

  return (
    <>
      <Card className="overflow-hidden">
        <ul className="divide-y">
          {domains.map((domain) => {
            const status = statusInfo(domain.status)
            const isRefreshing = refreshingId === domain.id

            return (
              <li key={domain.id} className="flex items-center gap-4 px-5 py-4">
                <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{domain.name}</div>
                  <span className={cn('vm-status mt-1', status.tone)}>{status.label}</span>
                </div>

                {domain.status !== 'verified' && (
                  <Button size="sm" onClick={() => onEditDomain?.(domain.id)}>
                    Configurar DNS
                  </Button>
                )}

                <RowActions>
                  <DropdownMenuItem onSelect={() => handleRefresh(domain.id)} disabled={isRefreshing}>
                    <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                    Verificar agora
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onEditDomain?.(domain.id)}>
                    <Settings2 className="h-4 w-4" />
                    Ver registros DNS
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => setDomainToDelete(domain)}>
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </RowActions>
              </li>
            )
          })}
        </ul>
      </Card>

      <ConfirmDialog
        isOpen={Boolean(domainToDelete)}
        onClose={() => setDomainToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir domínio"
        description={domainToDelete ? `Excluir ${domainToDelete.name}? Emails com esse remetente deixam de ser enviados.` : ''}
        variant="danger"
      />
    </>
  )
}
