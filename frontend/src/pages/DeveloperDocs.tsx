import { BookOpen, ExternalLink, Send, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { CodeSnippetCard } from '@/components/developer/CodeSnippetCard'
import {
  apiEndpointCatalog,
  apiKeyPresets,
  apiPermissionCatalog,
  buildSendEmailCurlExample,
  buildSendEmailFetchExample,
  buildWebhookPayloadExample,
  buildWebhookVerificationExample,
  getSwaggerDocsUrl,
  webhookEventCatalog,
} from '@/lib/developerPortal'

export function DeveloperDocs() {
  const liveEvents = webhookEventCatalog.filter((event) => event.availability === 'live')
  const plannedEvents = webhookEventCatalog.filter((event) => event.availability === 'planned')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentação"
        actions={
          <Button asChild variant="outline">
            <a href={getSwaggerDocsUrl()} target="_blank" rel="noreferrer">
              Referência da API
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Quickstart de envio</CardTitle>
            <CardDescription>Fluxo recomendado para colocar o primeiro email transacional no ar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {apiKeyPresets.map((preset) => (
                <div key={preset.id} className="rounded-xl border bg-muted/45 p-4">
                  <div className="text-sm font-semibold text-foreground">{preset.label}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{preset.description}</p>

                  {preset.recommendation ? <p className="mt-3 text-xs text-muted-foreground">{preset.recommendation}</p> : null}
                </div>
              ))}
            </div>

            <Separator />

            <CodeSnippetCard
              title="cURL"
              description="Exemplo minimo para testar a API com uma API key."
              code={buildSendEmailCurlExample()}
              language="bash"
            />
            <CodeSnippetCard
              title="JavaScript / fetch"
              description="Snippet para backend Node, edge function ou worker."
              code={buildSendEmailFetchExample()}
              language="ts"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Superficie da integracao</CardTitle>
            <CardDescription>O que a plataforma entrega hoje no caminho ativo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {apiEndpointCatalog.map((endpoint) => (
                <div key={endpoint.path} className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{endpoint.method}</Badge>
                    <span className="font-mono text-sm text-foreground">{endpoint.path}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{endpoint.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Permissoes de API key</CardTitle>
            <CardDescription>Use o menor escopo necessario para cada integracao.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {apiPermissionCatalog.map((permission) => (
              <div key={permission.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-foreground">{permission.label}</div>
                    <div className="text-xs font-mono text-muted-foreground">{permission.id}</div>
                  </div>
                  <Badge variant="outline">{permission.category}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{permission.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <Webhook className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle>Eventos de webhook</CardTitle>
                  <CardDescription>Catalogo alinhado ao que o backend emite hoje.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {liveEvents.map((event) => (
                  <div key={event.value} className="rounded-xl border border-[hsl(var(--success)/.3)] bg-[hsl(var(--success)/.1)] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">{event.label}</div>
                        <div className="text-xs font-mono text-muted-foreground">{event.value}</div>
                      </div>
                      <span className="vm-status vm-status-success">Live</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{event.deliveryMeaning}</p>
                  </div>
                ))}
              </div>

              {plannedEvents.length > 0 ? (
                <div className="rounded-xl border border-[hsl(var(--warning)/.3)] bg-[hsl(var(--warning)/.12)] p-4">
                  <div className="mb-2 font-medium text-foreground">Eventos planejados</div>
                  <div className="flex flex-wrap gap-2">
                    {plannedEvents.map((event) => (
                      <Badge key={event.value} variant="outline">
                        {event.value}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <CodeSnippetCard
            title="Validacao de assinatura"
            description="Valide o header X-Webhook-Signature com o corpo bruto da requisicao."
            code={buildWebhookVerificationExample()}
            language="ts"
          />
          <CodeSnippetCard
            title="Payload de exemplo"
            description="Formato base entregue pela VeloMail em webhooks reais."
            code={buildWebhookPayloadExample()}
            language="json"
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Send className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Envio</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            `email.delivered` representa aceite SMTP do servidor remoto. Para inbox placement e reputacao, acompanhe
            tambem autenticacao de dominio e reputacao do IP de saida.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Webhook className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Observabilidade</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Webhooks de teste, logs de entrega e analytics de mensagem precisam contar a mesma historia. As paginas de
            API Keys e Webhooks agora usam o mesmo catalogo e os mesmos exemplos.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Documentacao</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>Use esta pagina para onboarding e o OpenAPI para exploracao detalhada dos endpoints.</p>
            <Button asChild variant="outline" size="sm">
              <a href={getSwaggerDocsUrl()} target="_blank" rel="noreferrer">
                Abrir OpenAPI
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
