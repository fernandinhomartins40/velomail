import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SafeHTML } from '@/components/ui/SafeHTML'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page'
import { settingsApi, templateApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEmailSend } from '@/hooks/useEmailSend'
import { useVerifiedDomains, type UserDomain } from '@/hooks/useUserDomains'

type ContentMode = 'text' | 'html' | 'preview'

const selectClassName = 'h-10 rounded-lg border border-input bg-background px-3 text-sm'
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/** Variaveis podem vir como array de nomes, objeto ou JSON de qualquer um dos dois. */
const parseVariableNames = (value: unknown): string[] => {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (Array.isArray(parsed)) return parsed.map(String)
  if (parsed && typeof parsed === 'object') return Object.keys(parsed)
  return []
}

export function SendEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sendMutation = useEmailSend()

  const { data: domainsData, isLoading: domainsLoading } = useVerifiedDomains()
  const verifiedDomains: UserDomain[] = domainsData?.data?.domains || []
  const { data: templatesResponse } = useQuery({ queryKey: ['templates'], queryFn: templateApi.getTemplates })
  const { data: settingsResponse } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.getSettings })
  const templates: any[] = templatesResponse?.data?.templates || []
  const sendingSettings = settingsResponse?.data?.settings?.account_preferences?.sending_settings

  const [fromLocal, setFromLocal] = useState('contato')
  const [fromDomain, setFromDomain] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [html, setHtml] = useState('')
  const [mode, setMode] = useState<ContentMode>('text')
  const [templateId, setTemplateId] = useState('')
  const [variables, setVariables] = useState<Record<string, string>>({})

  // Remetente padrao das configuracoes, ou o primeiro dominio verificado.
  useEffect(() => {
    if (fromDomain || verifiedDomains.length === 0) return
    const defaultFrom: string = sendingSettings?.default_from_email || ''
    const [local, domain] = defaultFrom.split('@')
    const match = verifiedDomains.find((item) => item.domain_name === domain)
    if (match && local) {
      setFromLocal(local)
      setFromDomain(match.domain_name)
    } else {
      setFromDomain(verifiedDomains[0].domain_name)
    }
  }, [fromDomain, verifiedDomains, sendingSettings])

  const selectedTemplate = useMemo(
    () => templates.find((item) => String(item.id) === templateId),
    [templates, templateId]
  )
  const variableNames = useMemo(() => parseVariableNames(selectedTemplate?.variables), [selectedTemplate])

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const template = templates.find((item) => String(item.id) === id)
    if (!template) return
    setSubject(template.subject || '')
    setHtml(template.html_content || '')
    setText(template.text_content || '')
    setMode(template.html_content ? 'html' : 'text')
    setVariables({})
  }

  useEffect(() => {
    const fromUrl = searchParams.get('templateId')
    if (fromUrl && templates.length > 0 && !templateId) {
      applyTemplate(fromUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, templates])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const from = `${fromLocal.trim()}@${fromDomain}`

    if (!isEmail(from)) return toast.error('Remetente inválido')
    if (!isEmail(to)) return toast.error('Destinatário inválido')
    if (!subject.trim()) return toast.error('Escreva um assunto')
    if (!text.trim() && !html.trim()) return toast.error('Escreva a mensagem')

    await sendMutation.mutateAsync({
      from,
      to: to.trim(),
      subject,
      text: text || undefined,
      html: html || undefined,
      template_id: templateId || undefined,
      variables,
      tracking_enabled: sendingSettings?.open_tracking !== false || sendingSettings?.click_tracking !== false,
    })
    navigate('/app/emails')
  }

  if (!domainsLoading && verifiedDomains.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Novo email" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-muted-foreground">Para enviar, primeiro configure o seu domínio.</p>
            <Button asChild>
              <Link to="/app/domains?mode=setup">Configurar domínio</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Novo email" />

      <Card>
        <CardContent className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="from-local">De</Label>
              <div className="flex items-center gap-1.5">
                <Input id="from-local" value={fromLocal} onChange={(event) => setFromLocal(event.target.value)} className="w-32 shrink-0 sm:w-44" />
                <span className="text-muted-foreground">@</span>
                <select className={cn(selectClassName, 'min-w-0 flex-1')} value={fromDomain} onChange={(event) => setFromDomain(event.target.value)} aria-label="Domínio">
                  {verifiedDomains.map((domain) => (
                    <option key={domain.id} value={domain.domain_name}>{domain.domain_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">Para</Label>
              <Input id="to" type="email" placeholder="cliente@email.com" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>

            {templates.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="template">Template (opcional)</Label>
                <select id="template" className={cn(selectClassName, 'w-full')} value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
                  <option value="">Nenhum</option>
                  {templates.map((template) => (
                    <option key={template.id} value={String(template.id)}>{template.name}</option>
                  ))}
                </select>
              </div>
            )}

            {variableNames.length > 0 && (
              <div className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2">
                {variableNames.map((variable) => (
                  <div key={variable} className="space-y-1">
                    <Label htmlFor={`var-${variable}`} className="font-mono text-xs">{`{{${variable}}}`}</Label>
                    <Input
                      id={`var-${variable}`}
                      value={variables[variable] || ''}
                      onChange={(event) => setVariables({ ...variables, [variable]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="subject">Assunto</Label>
              <Input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="content">Mensagem</Label>
                <div className="flex rounded-lg border p-0.5 text-xs">
                  {([['text', 'Texto'], ['html', 'HTML'], ['preview', 'Prévia']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      className={cn('rounded-md px-2.5 py-1', mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'text' && (
                <Textarea id="content" rows={10} placeholder="Escreva sua mensagem..." value={text} onChange={(event) => setText(event.target.value)} />
              )}
              {mode === 'html' && (
                <Textarea id="content" rows={10} className="font-mono text-xs" placeholder="<p>Olá!</p>" value={html} onChange={(event) => setHtml(event.target.value)} />
              )}
              {mode === 'preview' && (
                <SafeHTML strict className="min-h-[240px] rounded-lg border bg-white p-4" html={html || text.replace(/\n/g, '<br />')} />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate('/app/emails')}>Cancelar</Button>
              <Button type="submit" disabled={sendMutation.isPending}>
                {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
