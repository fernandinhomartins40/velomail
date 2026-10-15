import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { DomainList } from '@/components/domain/DomainList'
import { DomainSetupWizard } from '@/components/domain/DomainSetupWizard'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { useDomainSetup } from '@/hooks/useDomainSetup'

type ViewMode = 'list' | 'setup'

interface DomainsPageProps {
  initialMode?: ViewMode
}

export const Domains: React.FC<DomainsPageProps> = ({ initialMode = 'list' }) => {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [viewMode, setViewMode] = useState<ViewMode>(searchParams.get('mode') === 'setup' ? 'setup' : initialMode)
  const [editingDomainId, setEditingDomainId] = useState<number | null>(
    searchParams.get('domainId') ? Number(searchParams.get('domainId')) : null
  )
  const { domains, loading, error, loadDomains, removeDomain, refreshDomain } = useDomainSetup()

  useEffect(() => {
    loadDomains()
  }, [loadDomains])

  useEffect(() => {
    const mode = searchParams.get('mode')
    const domainId = searchParams.get('domainId')

    setViewMode(mode === 'setup' ? 'setup' : 'list')
    setEditingDomainId(domainId ? Number(domainId) : null)
  }, [searchParams])

  const backToList = () => {
    setViewMode('list')
    setEditingDomainId(null)
    setSearchParams({})
  }

  const handleSetupComplete = () => {
    backToList()
    loadDomains()
    queryClient.invalidateQueries({ queryKey: ['account-usage'] })
  }

  const handleAddDomain = () => {
    setViewMode('setup')
    setEditingDomainId(null)
    setSearchParams({ mode: 'setup' })
  }

  const handleEditDomain = (domainId: number) => {
    setViewMode('setup')
    setEditingDomainId(domainId)
    setSearchParams({ mode: 'setup', domainId: String(domainId) })
  }

  if (viewMode === 'setup') {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Button variant="ghost" onClick={backToList}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <DomainSetupWizard
          onComplete={handleSetupComplete}
          onCancel={backToList}
          editDomainId={editingDomainId || undefined}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domínios"
        description="Envie emails com o seu próprio endereço, como contato@suaempresa.com."
        actions={
          <Button onClick={handleAddDomain}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar domínio
          </Button>
        }
      />

      <DomainList
        domains={domains}
        loading={loading}
        error={error}
        onReload={loadDomains}
        onRemoveDomain={removeDomain}
        onRefreshDomain={refreshDomain}
        onAddDomain={handleAddDomain}
        onEditDomain={handleEditDomain}
      />
    </div>
  )
}
