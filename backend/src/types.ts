// types.ts — tipos partilhados frontend/backend

export interface LinhaFatura {
  artigo_ref: string
  quantidade: number
  preco_unitario: number
  desconto_pct: number
  comentario?: string
  // preenchidos pela ficha do artigo (Firestore cache)
  artigo_descricao?: string
  iva_taxa?: number
}

export interface Fatura {
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string   // FAA, FR, FS...
  linhas: LinhaFatura[]
}

export interface ErroLinha {
  linha: number
  artigo_ref: string
  mensagem: string
}

export interface ResultadoFatura {
  index: number
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  sucesso: boolean
  numero_documento?: string
  pdf_url?: string         // URL Firebase Storage
  total_linhas: number
  linhas_ok: number
  erro?: string
  erros_linhas?: ErroLinha[]
  duracao_ms?: number
}

export interface JobEmissao {
  id: string
  tipo: 'emissao' | 'sync' | 'arquivo'
  estado: 'pendente' | 'ativo' | 'concluido' | 'erro'
  excel_url?: string
  criado_em: Date
  progresso: number        // 0-100
  log: string[]
  resultado?: {
    total: number
    emitidas: number
    erros: number
    faturas: ResultadoFatura[]
  }
}

export interface Artigo {
  codigo: string
  descricao: string
  taxa_iva: number
  preco_venda: number
  existencias: number
  ultima_sync: Date
}

export interface ConfigWinmax {
  winmax_url: string
  company_code: string
  utilizador: string
  password: string
  template_pdf: string
  pasta_pdf: string
  tipo_documento_default: string
  sync_data_inicio: string   // DD-MM-YYYY
  sync_data_fim: string      // DD-MM-YYYY (default: hoje)
  sync_hora: string          // HH:MM (cron diário)
}
