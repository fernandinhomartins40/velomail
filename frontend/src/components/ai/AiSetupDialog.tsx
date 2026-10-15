import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Copy, Loader2, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { aiApi } from '@/lib/api'
import { copyToClipboard } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface AiSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface McpServerConfig {
  url: string
  headers: Record<string, string>
}

interface CreatedAgentKey {
  key: string
  prompt: string
  cursorJson: string
  server: McpServerConfig
}

const SERVER_NAME = 'velomail'

/** Le o primeiro servidor de um mcp.json, seja do Cursor (mcpServers) ou do VS Code (servers). */
const parseServer = (configJson: string): McpServerConfig => {
  const parsed = JSON.parse(configJson)
  const servers = parsed.mcpServers || parsed.servers || {}
  const first = Object.values(servers)[0] as McpServerConfig
  return { url: first.url, headers: first.headers }
}

const cursorInstallLink = (server: McpServerConfig) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${btoa(JSON.stringify(server))}`

const vscodeInstallLink = (server: McpServerConfig) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'http', ...server }))}`

export function AiSetupDialog({ open, onOpenChange }: AiSetupDialogProps) {
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<CreatedAgentKey | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => aiApi.createAgentKey({ key_name: 'Editor com IA' }),
    onSuccess: (response) => {
      const { key, onboarding } = response.data
      const cursorJson = onboarding.cursor_mcp_json_with_key || onboarding.cursor_mcp_json
      setCreated({
        key,
        prompt: onboarding.prompt_template,
        cursorJson,
        server: parseServer(cursorJson),
      })
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || error.response?.data?.error || 'Não foi possível gerar a chave')
    },
  })

  const copy = async (text: string, message: string) => {
    await copyToClipboard(text)
    toast.success(message)
  }

  const handleCopyPrompt = async () => {
    if (!created) return
    await copy(created.prompt, 'Prompt copiado')
    setPromptCopied(true)
  }

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setShowManual(false)
      setPromptCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Configurar com IA
          </DialogTitle>
          <DialogDescription>
            Conecte seu editor e deixe a IA integrar a VeloMail no seu projeto.
          </DialogDescription>
        </DialogHeader>

        {!created ? (
          <Button size="lg" className="w-full" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Começar
          </Button>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-3">
              <li className="space-y-2">
                <div className="text-sm font-medium">1. Conecte seu editor</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline">
                    <a href={cursorInstallLink(created.server)}>Abrir no Cursor</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={vscodeInstallLink(created.server)}>Abrir no VS Code</a>
                  </Button>
                </div>
              </li>
              <li className="space-y-2">
                <div className="text-sm font-medium">2. Cole este prompt no chat do editor</div>
                <Button className="w-full" onClick={handleCopyPrompt}>
                  {promptCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {promptCopied ? 'Prompt copiado' : 'Copiar prompt'}
                </Button>
              </li>
            </ol>

            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowManual((value) => !value)}
              aria-expanded={showManual}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showManual ? 'rotate-180' : ''}`} />
              Usa outro editor? Configuração manual
            </button>

            {showManual && (
              <div className="space-y-2">
                <pre className="vm-code-surface max-h-48">{created.cursorJson}</pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => copy(created.cursorJson, 'Configuração copiada')}>
                    Copiar mcp.json
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copy(created.key, 'Chave copiada')}>
                    Copiar chave
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">A chave aparece só agora. Guarde em local seguro.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
