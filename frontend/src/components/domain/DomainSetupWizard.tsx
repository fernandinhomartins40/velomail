import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Copy, Loader2, RefreshCw, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Progress } from '../ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  type DNSInstructions,
  type DNSRecordInstruction,
  type DNSVerificationResult,
  type DomainSetupResult,
  type VerificationResult,
  useDomainSetup,
} from '../../hooks/useDomainSetup'

interface DomainSetupWizardProps {
  onComplete?: (domainId: number) => void
  onCancel?: () => void
  initialDomain?: string
  editDomainId?: number
}

const steps = ['Domínio', 'DNS', 'Pronto']

type DmarcPolicy = 'none' | 'quarantine' | 'reject'
type RecordKey = 'mail_from_mx' | 'spf' | 'dkim' | 'dmarc'

const recordRows: Array<{ key: RecordKey; type: string }> = [
  { key: 'mail_from_mx', type: 'MX' },
  { key: 'spf', type: 'TXT' },
  { key: 'dkim', type: 'TXT' },
  { key: 'dmarc', type: 'TXT' },
]

/** Dicas curtas para os paineis de DNS mais usados no Brasil. */
const providerTips: Record<string, string> = {
  'registro.br': 'Painel do Registro.br › seu domínio › DNS › Editar zona › Nova entrada.',
  hostinger: 'hPanel › Domínios › DNS / Nameservers › Adicionar registro.',
  cloudflare: 'Painel Cloudflare › seu domínio › DNS › Records › Add record. Deixe o proxy desligado (nuvem cinza).',
  godaddy: 'Meus produtos › DNS › Adicionar novo registro.',
  outro: 'Procure por "DNS", "Zona DNS" ou "Gerenciar DNS" no painel onde você comprou o domínio.',
}

/** Paineis de DNS pedem so a parte antes do dominio: "_dmarc" em vez de "_dmarc.empresa.com". */
const relativeHost = (host: string, domain: string) => {
  if (host === domain) return '@'
  return host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : host
}

const toSetupResult = (details: any, dns: any): DomainSetupResult => ({
  domain: {
    id: details.domain.id,
    name: details.domain.name,
    status: (['pending', 'partial', 'verified', 'failed'].includes(details.domain.status)
      ? details.domain.status
      : 'pending') as DomainSetupResult['domain']['status'],
    completion_percentage: details.domain.completion_percentage,
    is_verified: details.domain.is_verified,
    created_at: details.domain.created_at,
    verified_at: details.domain.verified_at,
  },
  dns_instructions: dns.instructions,
  setup_guide: dns.setup_guide,
})

export const DomainSetupWizard: React.FC<DomainSetupWizardProps> = ({
  onComplete,
  onCancel,
  initialDomain = '',
  editDomainId,
}) => {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [domain, setDomain] = useState(initialDomain)
  const [provider, setProvider] = useState('registro.br')
  const [setupResult, setSetupResult] = useState<DomainSetupResult | null>(null)
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [dmarcPolicy, setDmarcPolicy] = useState<DmarcPolicy>('none')

  const {
    loading,
    error,
    initiateDomainSetup,
    verifyDomainSetup,
    loadDomainDetails,
    getDNSInstructions,
    updateDomain,
    regenerateDKIMKeys,
    clearError,
  } = useDomainSetup()

  const isEditMode = Boolean(editDomainId)

  useEffect(() => {
    clearError()
  }, [currentStep, clearError])

  const reloadSetup = async (domainId: number) => {
    const [details, dns] = await Promise.all([loadDomainDetails(domainId), getDNSInstructions(domainId)])
    setSetupResult(toSetupResult(details, dns))
    return details
  }

  useEffect(() => {
    if (!editDomainId) {
      return
    }

    reloadSetup(editDomainId)
      .then((details) => {
        setDomain(details.domain.name)
        setDmarcPolicy((details.configuration.dmarc.policy || 'none') as DmarcPolicy)
        setCurrentStep(details.domain.is_verified ? 2 : 1)
      })
      .catch((loadError) => console.error('Erro ao carregar domínio:', loadError))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDomainId])

  const handleDomainSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    if (!cleaned) {
      toast.error('Informe um domínio válido')
      return
    }

    try {
      setDomain(cleaned)
      setSetupResult(await initiateDomainSetup(cleaned))
      setCurrentStep(1)
    } catch (submitError) {
      console.error('Falha ao iniciar configuração de domínio:', submitError)
    }
  }

  const handleVerification = async () => {
    if (!setupResult) {
      return
    }

    setIsVerifying(true)
    try {
      const result = await verifyDomainSetup(setupResult.domain.id)
      setVerificationResult(result)
      if (result.all_passed) {
        setCurrentStep(2)
      }
    } catch (verifyError) {
      console.error('Falha ao verificar domínio:', verifyError)
    } finally {
      setIsVerifying(false)
    }
  }

  const handleSaveDmarc = async () => {
    if (!setupResult) return
    if (await updateDomain(setupResult.domain.id, { dmarc_policy: dmarcPolicy })) {
      await reloadSetup(setupResult.domain.id)
    }
  }

  const handleRegenerateDkim = async () => {
    if (!setupResult) return
    await regenerateDKIMKeys(setupResult.domain.id)
    await reloadSetup(setupResult.domain.id)
  }

  const copy = async (text: string, label = 'Copiado') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const copyAllRecords = (instructions: DNSInstructions, rootDomain: string) => {
    const text = recordRows
      .map(({ key, type }) => {
        const record = instructions[key] as DNSRecordInstruction
        const priority = record.priority ? ` (prioridade ${record.priority})` : ''
        return `${type}  ${relativeHost(record.record, rootDomain)}  ${record.value}${priority}`
      })
      .join('\n')
    copy(text, 'Registros copiados')
  }

  const renderStatus = (result?: DNSVerificationResult) => {
    if (!result) return null
    return result.valid
      ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" aria-label="Encontrado" />
      : <AlertCircle className="h-4 w-4 text-destructive" aria-label="Não encontrado" />
  }

  const renderDomainStep = () => (
    <Card className="p-6">
      <form onSubmit={handleDomainSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="domain">Qual o seu domínio?</Label>
          <Input
            id="domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="suaempresa.com.br"
            disabled={loading || isEditMode}
            autoFocus
            required
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </Alert>
        )}

        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading || !domain.trim()}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continuar
          </Button>
        </div>
      </form>
    </Card>
  )

  const renderDnsStep = () => {
    if (!setupResult) return null
    const instructions = setupResult.dns_instructions
    const rootDomain = setupResult.domain.name

    return (
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          <h3 className="font-semibold">Adicione estes registros no seu DNS</h3>
          <p className="text-sm text-muted-foreground">Seu site e seu email atual continuam funcionando normalmente.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Label className="shrink-0 text-sm text-muted-foreground">Onde está seu domínio?</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registro.br">Registro.br</SelectItem>
              <SelectItem value="hostinger">Hostinger</SelectItem>
              <SelectItem value="cloudflare">Cloudflare</SelectItem>
              <SelectItem value="godaddy">GoDaddy</SelectItem>
              <SelectItem value="outro">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{providerTips[provider]}</p>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Valor</th>
                {verificationResult && <th className="px-3 py-2" aria-label="Status" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {recordRows.map(({ key, type }) => {
                const record = instructions[key] as DNSRecordInstruction
                const host = relativeHost(record.record, rootDomain)

                return (
                  <tr key={key} className="align-top">
                    <td className="px-3 py-2.5 font-medium">
                      {type}
                      {record.priority ? <div className="text-xs font-normal text-muted-foreground">prioridade {record.priority}</div> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        title={`Nome completo: ${record.record}`}
                        onClick={() => copy(host, 'Nome copiado')}
                        className="flex items-center gap-1.5 font-mono text-xs hover:text-primary"
                      >
                        {host}
                        <Copy className="h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => copy(record.value, 'Valor copiado')}
                        className="flex items-start gap-1.5 text-left font-mono text-xs hover:text-primary"
                      >
                        <span className="line-clamp-2 break-all">{record.value}</span>
                        <Copy className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    </td>
                    {verificationResult && (
                      <td className="px-3 py-2.5">{renderStatus(verificationResult.results[key])}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {verificationResult && !verificationResult.all_passed && (
          <p className="text-sm text-muted-foreground">
            Ainda não encontramos todos os registros. A propagação do DNS pode levar alguns minutos (às vezes algumas horas).
          </p>
        )}

        {isEditMode && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Avançado</summary>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Política DMARC</Label>
                <Select value={dmarcPolicy} onValueChange={(value: DmarcPolicy) => setDmarcPolicy(value)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="quarantine">quarantine</SelectItem>
                    <SelectItem value="reject">reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleSaveDmarc} disabled={loading}>
                Salvar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleRegenerateDkim} disabled={loading}>
                Gerar nova chave DKIM
              </Button>
            </div>
          </details>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => copyAllRecords(instructions, rootDomain)}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar todos
          </Button>
          <Button type="button" onClick={handleVerification} disabled={isVerifying}>
            {isVerifying
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : verificationResult && <RefreshCw className="mr-2 h-4 w-4" />}
            {verificationResult ? 'Verificar de novo' : 'Já adicionei, verificar'}
          </Button>
        </div>
      </Card>
    )
  }

  const renderDoneStep = () => (
    <Card className="space-y-5 p-8 text-center">
      <CheckCircle2 className="mx-auto h-14 w-14 text-[hsl(var(--success))]" />
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">Tudo pronto!</h3>
        <p className="text-muted-foreground">{setupResult?.domain.name} já pode enviar emails.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={() => navigate('/app/emails/send')}>
          <Send className="mr-2 h-4 w-4" />
          Enviar email de teste
        </Button>
        <Button variant="outline" onClick={() => setupResult && onComplete?.(setupResult.domain.id)}>
          Voltar para domínios
        </Button>
      </div>
    </Card>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{steps[currentStep]}</span>
          <span className="text-muted-foreground">Etapa {currentStep + 1} de {steps.length}</span>
        </div>
        <Progress value={((currentStep + 1) / steps.length) * 100} />
      </div>

      {currentStep === 0 && renderDomainStep()}
      {currentStep === 1 && renderDnsStep()}
      {currentStep === 2 && renderDoneStep()}
    </div>
  )
}
