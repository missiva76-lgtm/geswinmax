export interface Job {
  id: string
  tipo: 'emissao' | 'sync' | 'arquivo'
  estado: 'pendente' | 'ativo' | 'concluido' | 'erro'
  progresso: number
  log: string[]
  criado_em: { seconds: number }
  resultado?: {
    total: number
    emitidas: number
    erros: number
    faturas: FaturaResultado[]
  }
}

export interface FaturaResultado {
  index: number
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  sucesso: boolean
  numero_documento?: string
  pdf_url?: string
  total_linhas: number
  linhas_ok: number
  erro?: string
  erros_linhas?: { linha: number; artigo_ref: string; mensagem: string }[]
  duracao_ms?: number
}

export interface Artigo {
  codigo: string
  descricao: string
  taxa_iva: number
  preco_venda: number
  existencias: number
  ultima_sync?: { seconds: number }
}

export interface Config {
  winmax_url?: string
  company_code?: string
  utilizador?: string
  template_pdf?: string
  tipo_documento_default?: string
  sync_data_inicio?: string
  sync_data_fim?: string
  sync_hora?: string
}
