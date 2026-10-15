import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DomainSelector } from '@/components/domain/DomainSelector'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { SafeHTML } from '@/components/ui/SafeHTML'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page'
import { settingsApi, templateApi } from '@/lib/api'
import { useEmailSend } from '@/hooks/useEmailSend'
import { useHasVerifiedDomains } from '@/hooks/useUserDomains'

const sendEmailSchema = z.object({
  to: z.string().email('Email invalido'),
  from: z.string().min(1, 'Selecione um dominio remetente').email('Email remetente invalido'),
  subject: z.string().min(1, 'Assunto e obrigatorio'),
  html: z.string().optional(),
  text: z.string().min(1, 'Conteudo e obrigatorio'),
  template_id: z.string().optional(),
  tracking_enabled: z.boolean().default(true),
})

type SendEmailForm = z.infer<typeof sendEmailSchema>

const parseTemplateVariables = (value: unknown): Record<string, string> => {
  if (!value) {
    return {}
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return Object.fromEntries(parsed.map((item) => [String(item), '']))
      }

      return typeof parsed === 'object' && parsed ? parsed : {}
    } catch {
      return {}
    }
  }

  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item) => [String(item), '']))
  }

  if (typeof value === 'object') {
    return value as Record<string, string>
  }

  return {}
}

export function SendEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [customVariables, setCustomVariables] = useState<Record<string, string>>({})
  const [newVarKey, setNewVarKey] = useState('')
  const [newVarValue, setNewVarValue] = useState('')
  const hasVerifiedDomains = useHasVerifiedDomains()
  const sendEmailMutation = useEmailSend()

  const form = useForm<SendEmailForm>({
    resolver: zodResolver(sendEmailSchema),
    defaultValues: {
      from: '',
      to: '',
      subject: '',
      html: '',
      text: '',
      template_id: '',
      tracking_enabled: true,
    },
  })

  const { data: templatesResponse } = useQuery({
    queryKey: ['templates'],
    queryFn: templateApi.getTemplates,
  })

  const { data: settingsResponse } = useQuery({
    queryKey: ['settings', 'send-email-defaults'],
    queryFn: settingsApi.getSettings,
  })

  const templates = templatesResponse?.data?.templates || []

  useEffect(() => {
    const settings = settingsResponse?.data?.settings
    if (!settings) {
      return
    }

    const currentFrom = form.getValues('from')
    if (!currentFrom && settings.account_preferences?.sending_settings?.default_from_email) {
      form.setValue('from', settings.account_preferences.sending_settings.default_from_email)
    }

    if (typeof settings.account_preferences?.sending_settings?.open_tracking === 'boolean'
      || typeof settings.account_preferences?.sending_settings?.click_tracking === 'boolean') {
      form.setValue(
        'tracking_enabled',
        settings.account_preferences.sending_settings.open_tracking !== false
          || settings.account_preferences.sending_settings.click_tracking !== false
      )
    }
  }, [form, settingsResponse?.data?.settings])

  const onSubmit = async (data: SendEmailForm) => {
    if (!hasVerifiedDomains) {
      toast.error('Configure pelo menos um dominio verificado para enviar emails')
      return
    }

    await sendEmailMutation.mutateAsync({
      from: data.from,
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      template_id: data.template_id || undefined,
      tracking_enabled: data.tracking_enabled,
      variables: customVariables,
    })
    navigate('/app/emails')
  }

  const addCustomVariable = () => {
    if (newVarKey && newVarValue && !customVariables[newVarKey]) {
      setCustomVariables((current) => ({ ...current, [newVarKey]: newVarValue }))
      setNewVarKey('')
      setNewVarValue('')
    }
  }

  const removeCustomVariable = (key: string) => {
    const { [key]: _removed, ...rest } = customVariables
    setCustomVariables(rest)
  }

  const updateCustomVariable = (key: string, value: string) => {
    setCustomVariables((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const loadTemplate = (templateId: string) => {
    const template = templates.find((item: any) => item.id.toString() === templateId)

    if (!template) {
      return
    }

    form.setValue('template_id', templateId)
    form.setValue('subject', template.subject || '')
    form.setValue('html', template.html_content || '')
    form.setValue('text', template.text_content || '')
    setCustomVariables(parseTemplateVariables(template.variables))
  }

  useEffect(() => {
    const templateIdFromUrl = searchParams.get('templateId')
    if (!templateIdFromUrl || templates.length === 0) {
      return
    }

    const currentTemplateId = form.getValues('template_id')
    if (currentTemplateId === templateIdFromUrl) {
      return
    }

    const templateExists = templates.some((item: any) => String(item.id) === templateIdFromUrl)
    if (!templateExists) {
      return
    }

    loadTemplate(templateIdFromUrl)
  }, [form, searchParams, templates])

  const htmlPreview = form.watch('html')
  const textPreview = form.watch('text')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo email"
        className="gap-3"
        actions={<Button variant="ghost" onClick={() => navigate('/app/emails')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Email</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="from"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>De</FormLabel>
                          <FormControl>
                            <DomainSelector
                              value={field.value}
                              onChange={field.onChange}
                              placeholder="Selecione um dominio verificado"
                              disabled={!hasVerifiedDomains}
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                          {!hasVerifiedDomains && (
                            <FormDescription className="text-[hsl(var(--warning))]">
                              Configure pelo menos um dominio verificado para liberar o envio.
                            </FormDescription>
                          )}
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="to"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Para</FormLabel>
                          <FormControl>
                            <Input placeholder="destinatario@email.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assunto</FormLabel>
                        <FormControl>
                          <Input placeholder="Digite o assunto do email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Conteúdo</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="text" className="w-full">
                    <TabsList>
                      <TabsTrigger value="text">Texto</TabsTrigger>
                      <TabsTrigger value="html">HTML</TabsTrigger>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                    </TabsList>

                    <TabsContent value="text" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="text"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Texto</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Digite o conteudo do email em texto simples..."
                                rows={10}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>

                    <TabsContent value="html" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="html"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>HTML</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="<html><body>Digite o conteudo HTML...</body></html>"
                                rows={10}
                                className="font-mono"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>

                    <TabsContent value="preview">
                      <div className="rounded-lg border p-4">
                        {htmlPreview ? (
                          <SafeHTML html={htmlPreview} strict className="prose max-w-none" />
                        ) : (
                          <pre className="whitespace-pre-wrap">{textPreview || 'Nenhum conteudo para preview'}</pre>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              {templates.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Template</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Select onValueChange={loadTemplate}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template: any) => (
                          <SelectItem key={template.id} value={template.id.toString()}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Opções</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="tracking_enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <FormLabel>Tracking</FormLabel>
                            <FormDescription>
                              Habilita abertura e clique. Se o email tiver apenas texto, a plataforma gera HTML automaticamente para viabilizar a abertura.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Variáveis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input placeholder="chave" value={newVarKey} onChange={(event) => setNewVarKey(event.target.value)} />
                    <Input placeholder="valor" value={newVarValue} onChange={(event) => setNewVarValue(event.target.value)} />
                    <Button type="button" onClick={addCustomVariable} className="w-full sm:w-auto">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {Object.entries(customVariables).length > 0 && (
                    <div className="space-y-2">
                      {Object.entries(customVariables).map(([key, value]) => (
                        <div key={key} className="flex flex-col gap-2 rounded-lg border bg-muted/45 p-2 sm:flex-row sm:items-center">
                          <div className="font-mono text-sm sm:min-w-[120px]">{key}</div>
                          <Input
                            value={value}
                            onChange={(event) => updateCustomVariable(key, event.target.value)}
                            placeholder={`Valor para ${key}`}
                          />
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeCustomVariable(key)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-2">
                    <Button type="submit" className="w-full" disabled={sendEmailMutation.isPending || !hasVerifiedDomains}>
                      <Send className="mr-2 h-4 w-4" />
                      {sendEmailMutation.isPending ? 'Enviando...' : hasVerifiedDomains ? 'Enviar email' : 'Configure um dominio primeiro'}
                    </Button>

                    <Button type="button" variant="outline" onClick={() => navigate('/app/emails')}>
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
