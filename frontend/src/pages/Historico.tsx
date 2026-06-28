import { useState, useEffect } from 'react'
import { Search, FileText, ExternalLink, RefreshCw } from 'lucide-react'
import { getFaturas } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

interface FaturaEmitida {
  id?: string
  fatura_id: string
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  numero_documento: string
  pdf_url: string | null
  sucesso: boolean
  erro: string | null
  emitido_em?: { seconds: number }
  duracao_ms?: number
}

export default function Historico() {
  const [faturas, setFaturas]     = useState<FaturaEmitida[]>([])
  const [loading, setLoading]     = useState(true)
  const [q, setQ]                 = useState('')
  const [serverError, setServerError] = useState<Error | null>(null)
  const [tipoFiltro, setTipoFiltro]   = useState('')

  const carregar = async () => {
    setLoading(true)
    try {
      const res = await getFaturas()
      setFaturas(res)
      setServerError(null)
    } catch (e: any) {
      setServerError(e)
    }
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  const fmt = (f: FaturaEmitida) => {
    if (!f.emitido_em?.seconds) return '—'
    return new Date(f.emitido_em.seconds * 1000).toLocaleDateString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const tiposUnicos = Array.from(new Set(faturas.map(f => f.tipo_documento).filter(Boolean)))

  const filtradas = faturas.filter(f => {
    const qs = q.toLowerCase()
    const matchQ = !q || 
      f.numero_documento?.toLowerCase().includes(qs) ||
      f.cliente_nome?.toLowerCase().includes(qs) ||
      f.cliente_codigo?.toLowerCase().includes(qs) ||
      f.fatura_id?.toLowerCase().includes(qs)
    const matchTipo = !tipoFiltro || f.tipo_documento === tipoFiltro
    return matchQ && matchTipo
  })

  const emitidas = filtradas.filter(f => f.sucesso)
  const comErro  = filtradas.filter(f => !f.sucesso)

  const TIPO_COR: Record<string, string> = {
    FAA: 'bg-blue-100 text-blue-700',
    FRB: 'bg-purple-100 text-purple-700',
    FR:  'bg-green-100 text-green-700',
    FS:  'bg-teal-100 text-teal-700',
    FTB: 'bg-orange-100 text-orange-700',
    NCC: 'bg-red-100 text-red-700',
    GT:  'bg-yellow-100 text-yellow-700',
    FO:  'bg-pink-100 text-pink-700',
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <ServerWakingBanner error={serverError} onRetry={carregar} />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Histórico de emissões</h2>
          <p className="text-sm text-gray-400">Documentos emitidos via GesWinmax</p>
        </div>
        <button onClick={carregar}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
          Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Pesquisar por nº, cliente..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos os tipos</option>
          {tiposUnicos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Estatísticas */}
      <div className="flex gap-4 mb-4 text-sm text-gray-500">
        <span>{filtradas.length} documentos</span>
        <span className="text-green-600">✓ {emitidas.length} emitidos</span>
        {comErro.length > 0 && <span className="text-red-500">✗ {comErro.length} com erro</span>}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">A carregar...</div>
      ) : filtradas.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          {q || tipoFiltro ? 'Nenhum resultado para a pesquisa.' : 'Sem documentos emitidos.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Nº Documento</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Data emissão</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Cliente</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Total</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">PDF</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((f, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIPO_COR[f.tipo_documento] || 'bg-gray-100 text-gray-600'}`}>
                      {f.tipo_documento || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {f.numero_documento || f.fatura_id || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(f)}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[200px]">
                    {f.cliente_nome || f.cliente_codigo || '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 text-sm font-medium">
                    {(f as any).total != null ? `${Number((f as any).total).toFixed(2).replace('.', ',')} €` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {f.sucesso
                      ? <span className="text-xs text-green-600 font-medium">✓ Emitido</span>
                      : <span className="text-xs text-red-500 truncate max-w-[120px] block" title={f.erro || ''}>✗ {f.erro?.substring(0, 30) || 'Erro'}</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {f.pdf_url
                      ? <a href={f.pdf_url}
                          download={`${f.tipo_documento}_${(f.numero_documento || f.fatura_id || 'doc').replace('/', '_')}.pdf`}
                          className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs">
                          <FileText size={12}/> PDF
                        </a>
                      : <span className="text-gray-300 text-xs">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
