import React, { useState } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DomainDetails } from './DomainDetails';
import { DomainStatus } from '../../hooks/useDomainSetup';
import { 
  Plus, 
  Settings, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  XCircle,
  Eye,
  Copy,
  Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface DomainListProps {
  domains: DomainStatus[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void> | void;
  onRemoveDomain: (domainId: number) => Promise<boolean>;
  onRefreshDomain: (domainId: number) => Promise<void>;
  onAddDomain?: () => void;
  onViewDomain?: (domainId: number) => void;
  onEditDomain?: (domainId: number) => void;
}

export const DomainList: React.FC<DomainListProps> = ({
  domains,
  loading,
  error,
  onReload,
  onRemoveDomain,
  onRefreshDomain,
  onAddDomain,
  onViewDomain,
  onEditDomain
}) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [domainToDelete, setDomainToDelete] = useState<DomainStatus | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [refreshingDomains, setRefreshingDomains] = useState<Set<number>>(new Set());

  const getStatusColor = (status: DomainStatus['status']) => {
    switch (status) {
      case 'verified':
        return 'vm-status vm-status-success';
      case 'partial':
        return 'vm-status vm-status-warning';
      case 'pending':
        return 'vm-status vm-status-info';
      case 'failed':
        return 'vm-status vm-status-danger';
      default:
        return 'vm-status vm-status-neutral';
    }
  };

  const getStatusIcon = (status: DomainStatus['status']) => {
    switch (status) {
      case 'verified':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'partial':
        return <AlertCircle className="w-4 h-4" />;
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusLabel = (status: DomainStatus['status']) => {
    switch (status) {
      case 'verified':
        return 'Verificado';
      case 'partial':
        return 'Configuração Parcial';
      case 'pending':
        return 'Pendente';
      case 'failed':
        return 'Falhado';
      default:
        return 'Desconhecido';
    }
  };

  const handleDeleteDomain = async () => {
    if (!domainToDelete) return;

    try {
      await onRemoveDomain(domainToDelete.id);
      setDeleteDialogOpen(false);
      setDomainToDelete(null);
    } catch (error) {
      console.error('Failed to delete domain:', error);
    }
  };

  const handleRefreshDomain = async (domainId: number) => {
    setRefreshingDomains(prev => new Set([...prev, domainId]));
    try {
      await onRefreshDomain(domainId);
      toast.success('Status do domínio atualizado');
    } catch (error) {
      console.error('Failed to refresh domain:', error);
      toast.error('Erro ao atualizar domínio');
    } finally {
      setRefreshingDomains(prev => {
        const newSet = new Set(prev);
        newSet.delete(domainId);
        return newSet;
      });
    }
  };

  const handleViewDomain = (domainId: number) => {
    setSelectedDomainId(domainId);
    setDetailsDialogOpen(true);
  };

  const handleEditDomain = (domainId: number) => {
    setDetailsDialogOpen(false);
    onEditDomain?.(domainId);
  };

  const copyDomainName = async (domainName: string) => {
    try {
      await navigator.clipboard.writeText(domainName);
      toast.success('Nome do domínio copiado para área de transferência');
    } catch (error) {
      toast.error('Falha ao copiar nome do domínio');
    }
  };

  const renderDNSStatus = (domain: DomainStatus) => {
    const checks = [
      { name: 'MAIL FROM', status: domain.dns_status.mail_from },
      { name: 'DKIM', status: domain.dns_status.dkim },
      { name: 'SPF', status: domain.dns_status.spf },
      { name: 'DMARC', status: domain.dns_status.dmarc }
    ];

    return (
      <div className="flex flex-wrap gap-2">
        {checks.map(({ name, status }) => (
          <Badge
            key={name}
            variant={status.valid ? "default" : "destructive"}
            className="text-xs"
          >
            {name} {status.valid ? '✓' : '✗'}
          </Badge>
        ))}
      </div>
    );
  };

  const renderEmptyState = () => (
    <Card className="p-8 text-center">
      <div className="max-w-md mx-auto">
        <div className="mb-4">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Nenhum domínio adicionado
        </h3>
        <p className="text-muted-foreground mb-6">
          Adicione seu primeiro domínio para começar a enviar emails autenticados através da VeloMail.
        </p>
        <Button onClick={onAddDomain}>
          <Plus className="w-4 h-4 mr-2" />
          Adicionar Domínio
        </Button>
      </div>
    </Card>
  );

  const renderDomainCard = (domain: DomainStatus) => (
    <Card key={domain.id} className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2 sm:gap-3">
            <h3 className="break-all text-lg font-semibold">{domain.name}</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyDomainName(domain.name)}
              className="p-1"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className={getStatusColor(domain.status)}>
              {getStatusIcon(domain.status)}
              <span className="ml-1">{getStatusLabel(domain.status)}</span>
            </Badge>
            {domain.is_verified && (
              <Badge variant="outline" className="text-[hsl(var(--success))]">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Verificado
              </Badge>
            )}
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <div>Criado: {format(new Date(domain.created_at), 'dd/MM/yyyy')}</div>
            {domain.verified_at && (
              <div>Verificado: {format(new Date(domain.verified_at), 'dd/MM/yyyy HH:mm')}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRefreshDomain(domain.id)}
            disabled={refreshingDomains.has(domain.id)}
          >
            <RefreshCw className={`w-4 h-4 ${refreshingDomains.has(domain.id) ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleViewDomain(domain.id)}
            title="Visualizar detalhes do domínio"
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleEditDomain(domain.id)}
            title="Editar configurações do domínio"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDomainToDelete(domain);
              setDeleteDialogOpen(true);
            }}
            className="text-destructive hover:text-destructive"
            title="Remover domínio"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Progresso da Configuração</span>
          <span className="text-sm text-muted-foreground">{domain.completion_percentage}%</span>
        </div>
        <Progress value={domain.completion_percentage} className="h-2" />
      </div>

      {/* DNS Status */}
      <div className="mb-4">
        <div className="text-sm font-medium mb-2">Configuração DNS</div>
        {renderDNSStatus(domain)}
      </div>

      {/* Status specific messages */}
      {domain.status === 'failed' && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 text-destructive mr-2" />
            <span className="text-sm text-destructive">
              Verificação do domínio falhou. Clique no botão de configurações para ver detalhes e tentar novamente.
            </span>
          </div>
        </div>
      )}

      {domain.status === 'partial' && (
        <div className="rounded-lg border border-[hsl(var(--warning)/.3)] bg-[hsl(var(--warning)/.12)] p-3">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 text-[hsl(var(--warning))] mr-2" />
            <span className="text-sm text-[hsl(var(--warning))]">
              Alguns registros DNS estão faltando ou incorretos. Complete a configuração para começar a enviar emails.
            </span>
          </div>
        </div>
      )}

      {domain.status === 'pending' && (
        <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
          <div className="flex items-center">
            <Clock className="w-4 h-4 text-primary mr-2" />
            <span className="text-sm text-primary">
              Registros DNS estão sendo verificados. Isso pode levar alguns minutos.
            </span>
          </div>
        </div>
      )}

      {domain.status === 'verified' && (
        <div className="rounded-lg border border-[hsl(var(--success)/.3)] bg-[hsl(var(--success)/.12)] p-3">
          <div className="flex items-center">
            <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))] mr-2" />
            <span className="text-sm text-[hsl(var(--success))]">
              Domínio está totalmente configurado e pronto para enviar emails!
            </span>
          </div>
        </div>
      )}
    </Card>
  );

  if (loading && domains.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin mr-2" />
        <span>Carregando domínios...</span>
      </div>
    );
  }

  const renderErrorState = () => {
    const isAuthError = error?.includes('token') || error?.includes('Access') || error?.includes('login');
    
    return (
      <Card className="p-6 text-center">
        <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-3" />
        <h3 className="font-semibold text-foreground mb-2">
          {isAuthError ? 'Autenticação Necessária' : 'Erro ao Carregar Domínios'}
        </h3>
        <p className="text-muted-foreground mb-4">
          {isAuthError ? 'Faça login para visualizar e gerenciar seus domínios.' : error}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={onReload} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Tentar Novamente
          </Button>
          {isAuthError && (
            <Button onClick={onAddDomain}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Domínio
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Content Area */}
      {error && domains.length === 0 ? (
        renderErrorState()
      ) : (
        <>
          {/* Domain List */}
          {domains.length === 0 ? (
            renderEmptyState()
          ) : (
            <div className="grid gap-4">
              {domains.map(renderDomainCard)}
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Remover Domínio"
        description={
          domainToDelete
            ? `Tem certeza que deseja remover o domínio ${domainToDelete.name}? Esta ação não pode ser desfeita.`
            : ''
        }
        onConfirm={handleDeleteDomain}
        variant="danger"
      />

      {/* Domain Details Modal */}
      {selectedDomainId && (
        <DomainDetails
          domainId={selectedDomainId}
          isOpen={detailsDialogOpen}
          onClose={() => {
            setDetailsDialogOpen(false);
            setSelectedDomainId(null);
          }}
          onEdit={handleEditDomain}
        />
      )}
    </div>
  );
};
