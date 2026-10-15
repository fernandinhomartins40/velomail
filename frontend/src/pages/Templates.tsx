import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Copy,
  Download,
  Eye,
  Plus,
  Rocket,
  Save,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { SafeHTML } from '@/components/ui/SafeHTML'
import { templateApi } from '@/lib/api'
import { formatRelativeTime, generateRandomId } from '@/lib/utils'
import { RichTemplateEditor } from '@/components/templates/RichTemplateEditor'

const createTemplateSchema = z.object({
  name: z.string()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome deve ter no máximo 100 caracteres')
    .refine((name) => /^[\p{L}\p{N}\s\-_.()]+$/u.test(name), 'Nome contém caracteres inválidos'),
  subject: z.string().min(1, 'Assunto é obrigatório').max(255),
  html_content: z.string().optional(),
  text_content: z.string().optional(),
  variables: z.array(z.string()).optional()
}).refine((data) => data.html_content || data.text_content, {
  message: 'HTML ou texto deve ser fornecido'
})

type CreateTemplateForm = z.infer<typeof createTemplateSchema>

interface Template {
  id: number
  name: string
  subject: string
  html_content?: string
  text_content?: string
  variables: string[]
  category?: string
  created_at: string
  updated_at: string
}

const BUILTIN_MODELS = [
  {
    id: 'welcome-pro',
    label: 'Boas-vindas SaaS',
    category: 'welcome',
    subject: 'Bem-vindo(a), {{user_name}}!',
    html_content: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">
  <header style="padding:28px;background:#0f172a;color:#ffffff">
    <h1 style="margin:0;font-size:24px">Seja bem-vindo(a), {{user_name}}</h1>
    <p style="margin:10px 0 0;opacity:.9">Sua conta na {{company_name}} está pronta.</p>
  </header>
  <main style="padding:28px;color:#0f172a">
    <p>Ative seu workspace e configure seu primeiro domínio para começar os envios.</p>
    <a href="{{cta_url}}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Começar agora</a>
  </main>
</div>`.trim(),
    text_content: 'Olá {{user_name}}, sua conta na {{company_name}} está pronta. Acesse {{cta_url}}.',
    variables: ['user_name', 'company_name', 'cta_url']
  },
  {
    id: 'invoice',
    label: 'Recibo transacional',
    category: 'transactional',
    subject: 'Recibo #{{invoice_id}} disponível',
    html_content: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px">
  <div style="padding:24px;background:#16a34a;color:#fff;border-radius:14px 14px 0 0">
    <h2 style="margin:0">Pagamento confirmado</h2>
  </div>
  <div style="padding:24px;color:#0f172a">
    <p>Olá {{customer_name}}, recebemos seu pagamento.</p>
    <p><strong>Recibo:</strong> #{{invoice_id}}</p>
    <p><strong>Valor:</strong> {{total_amount}}</p>
    <p style="font-size:13px;color:#64748b">Suporte: {{support_email}}</p>
  </div>
</div>`.trim(),
    text_content: 'Pagamento confirmado. Recibo #{{invoice_id}} no valor de {{total_amount}}.',
    variables: ['customer_name', 'invoice_id', 'total_amount', 'support_email']
  },
  {
    id: 'newsletter',
    label: 'Newsletter mensal',
    category: 'newsletter',
    subject: '{{month}} em {{company_name}}',
    html_content: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">
  <header style="background:#1d4ed8;color:#fff;padding:24px">
    <h1 style="margin:0">{{headline}}</h1>
    <p style="margin-top:10px">Resumo do mês {{month}}</p>
  </header>
  <main style="padding:24px;color:#0f172a">
    <p>{{summary}}</p>
    <a href="{{cta_url}}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ler atualização completa</a>
  </main>
</div>`.trim(),
    text_content: '{{headline}} - {{summary}}. Leia mais em {{cta_url}}.',
    variables: ['month', 'company_name', 'headline', 'summary', 'cta_url']
  }
]

const extractVariables = (content: string): string[] => {
  const regex = /{{\s*([^}\s]+)\s*}}/g
  const variables: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !variables.includes(match[1])) {
      variables.push(match[1])
    }
  }

  return variables
}

const processTemplate = (content: string, variables: Record<string, string>) => {
  let processed = content
  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
    processed = processed.replace(regex, variables[key] || `{{${key}}}`)
  })
  return processed
}

export function Templates() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeEditorTab, setActiveEditorTab] = useState('rich')
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [previewData, setPreviewData] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CreateTemplateForm>({
    resolver: zodResolver(createTemplateSchema),
    defaultValues: {
      name: '',
      subject: '',
      html_content: '',
      text_content: '',
      variables: []
    }
  })

  const { data: templatesResponse, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: templateApi.getTemplates
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateTemplateForm) => templateApi.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template criado com sucesso')
      setIsCreating(false)
    },
    onError: () => toast.error('Erro ao criar template')
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateTemplateForm }) => templateApi.updateTemplate(String(id), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template atualizado com sucesso')
    },
    onError: () => toast.error('Erro ao atualizar template')
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => templateApi.deleteTemplate(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      if (selectedTemplate && deleteTarget?.id === selectedTemplate.id) {
        setSelectedTemplate(null)
        setIsCreating(false)
        reset({
          name: '',
          subject: '',
          html_content: '',
          text_content: '',
          variables: []
        })
      }
      toast.success('Template removido')
    },
    onError: () => toast.error('Erro ao remover template')
  })

  const templates: Template[] = templatesResponse?.data?.templates || []

  const filteredTemplates = useMemo(
    () => templates.filter((template) => {
      const needle = search.toLowerCase()
      return template.name.toLowerCase().includes(needle)
        || template.subject.toLowerCase().includes(needle)
        || (template.category || '').toLowerCase().includes(needle)
    }),
    [search, templates]
  )

  const htmlContent = watch('html_content') || ''
  const textContent = watch('text_content') || ''
  const subject = watch('subject') || ''
  const variables = watch('variables') || []

  useEffect(() => {
    const htmlVars = extractVariables(htmlContent)
    const textVars = extractVariables(textContent)
    const subjectVars = extractVariables(subject)
    const allVars = Array.from(new Set([...htmlVars, ...textVars, ...subjectVars]))
    setValue('variables', allVars)
  }, [htmlContent, textContent, subject, setValue])

  const onSubmit = (data: CreateTemplateForm) => {
    const payload: CreateTemplateForm = {
      ...data,
      html_content: data.html_content || undefined,
      text_content: data.text_content || undefined,
      variables: data.variables || []
    }

    if (selectedTemplate && !isCreating) {
      updateMutation.mutate({ id: selectedTemplate.id, data: payload })
      return
    }

    createMutation.mutate(payload)
  }

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template)
    setIsCreating(false)
    setValue('name', template.name)
    setValue('subject', template.subject)
    setValue('html_content', template.html_content || '')
    setValue('text_content', template.text_content || '')
    setValue('variables', template.variables || [])
  }

  const handleCreateNew = () => {
    setIsCreating(true)
    setSelectedTemplate(null)
    reset({
      name: `Novo template ${generateRandomId()}`,
      subject: '',
      html_content: '',
      text_content: '',
      variables: []
    })
  }

  const loadFromModel = (model: typeof BUILTIN_MODELS[number]) => {
    setIsCreating(true)
    setSelectedTemplate(null)
    setValue('name', `${model.label} ${generateRandomId()}`)
    setValue('subject', model.subject)
    setValue('html_content', model.html_content)
    setValue('text_content', model.text_content)
    setValue('variables', model.variables)
    setActiveEditorTab('rich')
    toast.success(`Modelo "${model.label}" carregado`)
  }

  const duplicateSelected = () => {
    if (!selectedTemplate) {
      return
    }

    setIsCreating(true)
    setSelectedTemplate(null)
    setValue('name', `${selectedTemplate.name} (Cópia)`)
    toast.success('Template duplicado em modo de criação')
  }

  const fillPreviewData = () => {
    const values: Record<string, string> = {}
    variables.forEach((variable) => {
      values[variable] = values[variable] || `[${variable}]`
    })
    setPreviewData(values)
    setActiveEditorTab('preview')
  }

  const exportSelected = () => {
    if (!selectedTemplate) {
      return
    }

    const data = JSON.stringify(selectedTemplate, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `template-${selectedTemplate.name.toLowerCase().replace(/\s+/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('Template exportado')
  }

  const importFromFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      try {
        const parsed = JSON.parse(String(loadEvent.target?.result || '{}'))
        const validated = createTemplateSchema.safeParse({
          name: parsed.name || '',
          subject: parsed.subject || '',
          html_content: parsed.html_content || '',
          text_content: parsed.text_content || '',
          variables: Array.isArray(parsed.variables) ? parsed.variables : []
        })

        if (!validated.success) {
          toast.error(validated.error.errors[0]?.message || 'Arquivo inválido')
          return
        }

        setIsCreating(true)
        setSelectedTemplate(null)
        setValue('name', validated.data.name)
        setValue('subject', validated.data.subject)
        setValue('html_content', validated.data.html_content || '')
        setValue('text_content', validated.data.text_content || '')
        setValue('variables', validated.data.variables || [])
        setActiveEditorTab('rich')
        toast.success('Template importado com sucesso')
      } catch {
        toast.error('Falha ao ler arquivo de template')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const processedHtml = processTemplate(htmlContent, previewData)
  const processedText = processTemplate(textContent, previewData)
  const processedSubject = processTemplate(subject, previewData)

  return (
    <div className="space-y-6">
      <div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
            <Card className="overflow-hidden xl:h-[calc(100vh-220px)]">
              <CardHeader className="border-b pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Meus templates</CardTitle>
                    <CardDescription>Gerencie sua biblioteca privada</CardDescription>
                  </div>
                  <Button size="sm" onClick={handleCreateNew}>
                    <Plus className="mr-1 h-4 w-4" />
                    Novo
                  </Button>
                </div>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                    placeholder="Buscar template..."
                  />
                </div>
              </CardHeader>

              <CardContent className="space-y-4 overflow-y-auto p-4 xl:h-full">
                <input
                  id="template-import"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={importFromFile}
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('template-import')?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Importar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportSelected}
                    disabled={!selectedTemplate}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Exportar
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label className="vm-metric-label">Modelos padrão editáveis</Label>
                  <div className="space-y-2">
                    {BUILTIN_MODELS.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        onClick={() => loadFromModel(model)}
                        className="w-full rounded-xl border bg-muted/45 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="font-medium text-foreground">{model.label}</div>
                          <Badge variant="outline">{model.category}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{model.subject}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pb-20">
                  <Label className="vm-metric-label">Templates salvos</Label>
                  {isLoading ? (
                    <div className="text-sm text-muted-foreground">Carregando...</div>
                  ) : filteredTemplates.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      Nenhum template encontrado.
                    </div>
                  ) : (
                    filteredTemplates.map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        onClick={() => handleSelectTemplate(template)}
                        className={`w-full rounded-xl border p-3 text-left transition-colors ${
                          selectedTemplate?.id === template.id && !isCreating
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-foreground">{template.name}</div>
                            <div className="line-clamp-1 text-xs text-muted-foreground">{template.subject}</div>
                          </div>
                          {template.variables?.length ? (
                            <Badge variant="outline">{template.variables.length}</Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{formatRelativeTime(template.updated_at)}</div>
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">
                      {isCreating ? 'Novo template' : selectedTemplate?.name || 'Editor de template'}
                    </CardTitle>
                    <CardDescription>
                      Editor rico + código fonte + preview em tempo real.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={fillPreviewData}>
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                    <Button variant="outline" size="sm" onClick={duplicateSelected} disabled={!selectedTemplate || isCreating}>
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedTemplate}
                      onClick={() => selectedTemplate && navigate(`/app/emails/send?templateId=${selectedTemplate.id}`)}
                    >
                      <Rocket className="mr-2 h-4 w-4" />
                      Usar no envio
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => selectedTemplate && setDeleteTarget(selectedTemplate)}
                      disabled={!selectedTemplate || isCreating}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir
                    </Button>
                    <Button onClick={handleSubmit(onSubmit)} size="sm" disabled={createMutation.isPending || updateMutation.isPending}>
                      <Save className="mr-2 h-4 w-4" />
                      {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 p-4 sm:p-6">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <Label htmlFor="template-name">Nome</Label>
                    <Input id="template-name" placeholder="Ex: Confirmação de pedido" {...register('name')} />
                    {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name.message}</p> : null}
                  </div>
                  <div>
                    <Label htmlFor="template-subject">Assunto</Label>
                    <Input id="template-subject" placeholder="Ex: Pedido #{{order_id}} confirmado" {...register('subject')} />
                    {errors.subject ? <p className="mt-1 text-xs text-destructive">{errors.subject.message}</p> : null}
                  </div>
                </div>

                <Tabs value={activeEditorTab} onValueChange={setActiveEditorTab}>
                  <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                    <TabsTrigger value="rich">Editor rico</TabsTrigger>
                    <TabsTrigger value="html">HTML</TabsTrigger>
                    <TabsTrigger value="text">Texto</TabsTrigger>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                  </TabsList>

                  <TabsContent value="rich" className="mt-4">
                    <RichTemplateEditor
                      value={htmlContent}
                      onChange={(value) => setValue('html_content', value, { shouldDirty: true, shouldValidate: true })}
                      placeholder="Monte seu email com formatação, links, CTA e variáveis dinâmicas..."
                    />
                  </TabsContent>

                  <TabsContent value="html" className="mt-4">
                    <Textarea
                      rows={18}
                      className="font-mono text-sm"
                      placeholder="<h1>Olá {{user_name}}</h1>"
                      value={htmlContent}
                      onChange={(event) => setValue('html_content', event.target.value, { shouldDirty: true, shouldValidate: true })}
                    />
                  </TabsContent>

                  <TabsContent value="text" className="mt-4">
                    <Textarea
                      rows={18}
                      className="font-mono text-sm"
                      placeholder="Versão de texto puro"
                      {...register('text_content')}
                    />
                  </TabsContent>

                  <TabsContent value="preview" className="mt-4">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Variáveis</CardTitle>
                          <CardDescription>Preencha dados para validar a renderização</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {variables.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nenhuma variável detectada.</p>
                          ) : (
                            variables.map((variable) => (
                              <div key={variable}>
                                <Label htmlFor={`var-${variable}`}>{variable}</Label>
                                <Input
                                  id={`var-${variable}`}
                                  value={previewData[variable] || ''}
                                  onChange={(event) => setPreviewData((prev) => ({ ...prev, [variable]: event.target.value }))}
                                  placeholder={`Valor para ${variable}`}
                                />
                              </div>
                            ))
                          )}
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Preview final</CardTitle>
                          <CardDescription>Assunto: {processedSubject || '(sem assunto)'}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <SafeHTML
                            strict
                            className="min-h-[420px] rounded-xl border bg-white p-4"
                            html={processedHtml || processedText.replace(/\n/g, '<br />')}
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>

              </CardContent>
            </Card>
          </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id)
          }
        }}
        title="Excluir template"
        description={deleteTarget ? `Deseja excluir "${deleteTarget.name}"?` : ''}
        variant="danger"
      />
    </div>
  )
}
