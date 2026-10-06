import { Badge } from '@/components/ui/badge'
import type { Pagination } from './types'

export const toPagination = (value: any): Pagination => ({
  page: Number(value?.page || 1),
  total_pages: Number(value?.total_pages || 1),
  total: Number(value?.total || 0)
})

export const boolBadge = (value: boolean, enabled: string, disabled: string) => (
  <Badge variant={value ? 'success' : 'secondary'}>
    {value ? enabled : disabled}
  </Badge>
)

export const formatNumber = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('pt-BR')
