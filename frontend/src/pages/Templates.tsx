import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Copy, FileText, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, RowActions } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page'
import { SafeHTML } from '@/components/ui/SafeHTML'
import { Textarea } from '@/components/ui/textarea'
import { RichTemplateEditor } from '@/components/templates/RichTemplateEditor'
import { templateApi } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'

interface Template {
  id: number
  name: string
  subject: string
  html_content?: string
  text_content?: string
  variables: string[]
  updated_at: string
}

interface Draft {
  id: number | null
  name: string
  subject: string
  html_content: string
  text_content: string
}

type EditorMode = 'visual' | 'html' | 'preview'

const STARTER_MODELS: Array<Omit<Draft, 'id'>> = [
  {
    name: 'Boas-vindas',
    subject: 'Bem-vindo(a), {{nome}}!',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#0f172a">
  <h1 style="margin:0 0 12px;font-size:22px">Olá, {{nome}}!</h1>
  <p>Sua conta está pronta. É só clicar abaixo para começar.</p>
  <a href="{{link}}" style="display:inline-block;margin-top:12px;background:#049fea;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Começar</a>
</div>`,
    text_content: 'Olá, {{nome}}! Sua conta está pronta. Comece em: {{link}}',
  },
  {
    name: 'Pagamento confirmado',
    subject: 'Pedido #{{pedido}} confirmado',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#0f172a">
  <h1 style="margin:0 0 12px;font-size:22px">Pagamento confirmado</h1>
  <p>Olá, {{nome}}. Recebemos o pagamento do pedido <strong>#{{pedido}}</strong>.</p>
  <p>Valor: <strong>{{valor}}</strong></p>
</div>`,
    text_content: 'Olá, {{nome}}. Recebemos o pagamento do pedido #{{pedido}} no valor de {{valor}}.',
  },
  {
    name: 'Redefinir senha',
    subject: 'Redefina sua senha',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#0f172a">
  <h1 style="margin:0 0 12px;font-size:22px">Redefinir senha</h1>
  <p>Recebemos um pedido para redefinir sua senha. O link vale por 1 hora.</p>
  <a href="{{link}}" style="display:inline-block;margin-top:12px;background:#049fea;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Criar nova senha</a>
  <p style="margin-top:24px;font-size:13px;color:#64748b">Se não foi você, ignore este email.</p>
</div>`,
    text_content: 'Para redefinir sua senha, acesse: {{link}} (vale por 1 hora). Se não foi você, ignore este email.',
  },
]

const emptyDraft: Draft = { id: null, name: '', subject: '', html_content: '', text_content: '' }

const extractVariables = (...contents: string[]) => {
  const found = new Set<string>()
  const regex = /{{\s*([^}\s]+)\s*}}/g
  contents.forEach((content) => {
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) found.add(match[1])
  })
  return Array.from(found)
}

export function Templates() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [mode, setMode] = useState<EditorMode>('visual')
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['templates'], queryFn: templateApi.getTemplates })
  const templates: Template[] = data?.data?.templates || []

  const variables = useMemo(
    () => (draft ? extractVariables(draft.subject, draft.html_content, draft.text_content) : []),
    [draft]
  )

  const onError = (fallback: string) => (error: any) => {
    toast.error(error.response?.data?.message || error.response?.data?.error || fallback)
  }

  const saveMutation = useMutation({
    mutationFn: (current: Draft) => {
      const payload = {
        name: current.name.trim(),
        subject: current.subject,
        html_content: current.html_content || undefined,
        text_content: current.text_content || undefined,
        variables,
      }
      return current.id ? templateApi.updateTemplate(String(current.id), payload) : templateApi.createTemplate(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template salvo')
      setDraft(null)
    },
    onError: onError('Não foi possível salvar o template'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => templateApi.deleteTemplate(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setDeleteTarget(null)
      toast.success('Template excluído')
    },
    onError: onError('Não foi possível excluir o template'),
  })

  const openDraft = (next: Draft) => {
    setDraft(next)
    setMode(next.html_content ? 'visual' : 'html')
  }

  const edit = (template: Template) => openDraft({
    id: template.id,
    name: template.name,
    subject: template.subject,
    html_content: template.html_content || '',
    text_content: template.text_content || '',
  })

  const handleSave = () => {
    if (!draft) return
    if (!draft.name.trim()) return toast.error('Dê um nome ao template')
    if (!draft.subject.trim()) return toast.error('Escreva um assunto')
    if (!draft.html_content.trim() && !draft.text_content.trim()) return toast.error('Escreva o conteúdo')
    saveMutation.mutate(draft)
  }

  const newTemplateMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo template
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => openDraft({ ...emptyDraft })}>Em branco</DropdownMenuItem>
        {STARTER_MODELS.map((model) => (
          <DropdownMenuItem key={model.name} onSelect={() => openDraft({ ...model, id: null })}>
            {model.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (draft) {
    const setField = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Templates
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="template-name">Nome</Label>
                <Input id="template-name" placeholder="Ex: Pedido confirmado" value={draft.name} onChange={(event) => setField({ name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-subject">Assunto</Label>
                <Input id="template-subject" placeholder="Pedido #{{pedido}} confirmado" value={draft.subject} onChange={(event) => setField({ subject: event.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conteúdo</Label>
                <div className="flex rounded-lg border p-0.5 text-xs">
                  {([['visual', 'Visual'], ['html', 'HTML'], ['preview', 'Prévia']] as const).map(([value, label]) => (
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

              {mode === 'visual' && (
                <RichTemplateEditor
                  value={draft.html_content}
                  onChange={(value) => setField({ html_content: value })}
                  placeholder="Escreva seu email..."
                />
              )}
              {mode === 'html' && (
                <Textarea rows={16} className="font-mono text-xs" value={draft.html_content} onChange={(event) => setField({ html_content: event.target.value })} />
              )}
              {mode === 'preview' && (
                <SafeHTML strict className="min-h-[320px] rounded-lg border bg-white p-4" html={draft.html_content || draft.text_content.replace(/\n/g, '<br />')} />
              )}
            </div>

            {variables.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Variáveis:{' '}
                {variables.map((variable) => (
                  <code key={variable} className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${variable}}}`}</code>
                ))}
              </p>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Versão em texto simples (opcional)
              </summary>
              <Textarea
                rows={5}
                className="mt-2"
                placeholder="Usada por apps de email que não mostram HTML."
                value={draft.text_content}
                onChange={(event) => setField({ text_content: event.target.value })}
              />
            </details>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Templates" description="Emails prontos para reutilizar, com campos como {{nome}}." actions={newTemplateMenu} />

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted/40" />
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Comece com um modelo pronto:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_MODELS.map((model) => (
                <Button key={model.name} variant="outline" onClick={() => openDraft({ ...model, id: null })}>
                  {model.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-4 px-5 py-3">
                <button type="button" onClick={() => edit(template)} className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{template.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{template.subject}</div>
                </button>
                <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">
                  {formatRelativeTime(template.updated_at)}
                </span>
                <RowActions>
                  <DropdownMenuItem onSelect={() => edit(template)}>
                    <Pencil className="h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate(`/app/emails/send?templateId=${template.id}`)}>
                    <Send className="h-4 w-4" />
                    Usar no envio
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openDraft({
                      id: null,
                      name: `${template.name} (cópia)`,
                      subject: template.subject,
                      html_content: template.html_content || '',
                      text_content: template.text_content || '',
                    })}
                  >
                    <Copy className="h-4 w-4" />
                    Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => setDeleteTarget(template)}>
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </RowActions>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Excluir template"
        description={deleteTarget ? `Excluir "${deleteTarget.name}"?` : ''}
        variant="danger"
      />
    </div>
  )
}
