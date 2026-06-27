export interface LinhaFatura {
  artigo_ref: string
  quantidade: number
  preco_unitario: number
  desconto_pct: number
  comentario?: string
}

export interface Fatura {
  fatura_id: string            // identifica unicamente cada documento no Excel
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  linhas: LinhaFatura[]
}

export interface ErroLinha {
  linha: number
  artigo_ref: string
  mensagem: string
}

export interface ResultadoFatura {
  index: number
  fatura_id: string
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  sucesso: boolean
  numero_documento?: string
  pdf_url?: string
  total?: number
  total_linhas: number
  linhas_ok: number
  erro?: string
  erros_linhas?: ErroLinha[]
  duracao_ms?: number
}

export interface ConfigWinmax {
  winmax_url: string
  company_code: string
  utilizador: string
  password: string
  template_pdf: string
  tipo_documento_default: string
  sync_data_inicio: string
  sync_data_fim: string
  sync_hora: string
}
