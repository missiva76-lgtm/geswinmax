import { useState, useEffect } from 'react'
import { Search, FileText, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'
import { getFaturas } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

interface FaturaEmitida {
  id?: string
  fatura_id: string
  cliente_codigo: string
  cliente_nome: string
  tipo_documento: string
  numero_documento: string
  data_documento?: string
  pdf_url: string | null
  sucesso: boolean
  erro: string | null
  total?: number
  emitido_em?: { seconds: number }
  data_submissao?: { seconds: number }
}

type SortField = 'fatura_id' | 'emitido_em' | 'data_documento' | 'cliente_nome' | 'total' | 'sucesso'
type SortDir = 'asc' | 'desc'

const TIPO_COR: Record<string, string> = {
  FAA: 'bg-blue-100 text-blue-700',
  FRB: 'bg-purple-100 text-purple-700',
  FR:  'bg-green-100 text-green-700',
  FS:  'bg-teal-100 text-teal-700',
  FTB: 'bg-orange-100 text-orange-700',
  NCC: 'bg-red-100 text-red-700',
  GT:  'bg-yellow-100 text-yellow-700',
}

const fmtTs = (ts?: { seconds: number }) => {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('pt-PT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const fmtEur = (v?: number | null) =>
  v != null ? `${Number(v).toFixed(2).replace('.', ',')} €` : '—'

export default function Historico() {
  const [faturas, setFaturas]       = useState<FaturaEmitida[]>([])
  const [loading, setLoading]       = useState(true)
  const [q, setQ]                   = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [estadoFiltro, setEstado]   = useState<''|'ok'|'erro'>('')
  const [sortField, setSortField]   = useState<SortField>('emitido_em')
  const [sortDir, setSortDir]       = useState<SortDir>('desc')
  const [serverError, setServerError] = useState<Error | null>(null)

  const carregar = async () => {
    setLoading(true)
    try {
      const res = await getFaturas()
      setFaturas(res)
      setServerError(null)
    } catch (e: any) { setServerError(e) }
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-300 ml-1">↕</span>
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline ml-1 text-teal-600"/>
      : <ChevronDown size={11} className="inline ml-1 text-teal-600"/>
  }

  const Th = ({ label, field, right }: { label: string; field: SortField; right?: boolean }) => (
    <th onClick={() => handleSort(field)}
      className={`px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer hover:text-teal-600 select-none ${right ? 'text-right' : 'text-left'}`}>
      {label}<SortIcon field={field}/>
    </th>
  )

  const tiposUnicos = Array.from(new Set(faturas.map(f => f.tipo_documento).filter(Boolean))).sort()

  const filtradas = faturas.filter(f => {
    const qs = q.toLowerCase()
    const matchQ = !q ||
      f.numero_documento?.toLowerCase().includes(qs) ||
      f.cliente_nome?.toLowerCase().includes(qs) ||
      f.cliente_codigo?.toLowerCase().includes(qs) ||
      f.fatura_id?.toLowerCase().includes(qs)
    const matchTipo   = !tipoFiltro || f.tipo_documento === tipoFiltro
    const matchEstado = !estadoFiltro || (estadoFiltro === 'ok' ? f.sucesso : !f.sucesso)
    return matchQ && matchTipo && matchEstado
  })

  const ordenadas = [...filtradas].sort((a, b) => {
    let va: any, vb: any
    switch (sortField) {
      case 'fatura_id':      va = a.fatura_id; vb = b.fatura_id; break
      case 'emitido_em':     va = a.emitido_em?.seconds ?? 0; vb = b.emitido_em?.seconds ?? 0; break
      case 'data_documento': va = a.data_documento ?? ''; vb = b.data_documento ?? ''; break
      case 'cliente_nome':   va = a.cliente_nome ?? ''; vb = b.cliente_nome ?? ''; break
      case 'total':          va = a.total ?? 0; vb = b.total ?? 0; break
      case 'sucesso':        va = a.sucesso ? 1 : 0; vb = b.sucesso ? 1 : 0; break
    }
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const emitidas = filtradas.filter(f => f.sucesso).length
  const comErro  = filtradas.filter(f => !f.sucesso).length

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
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Pesquisar ID, nº, cliente..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300"/>
        </div>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">Todos os tipos</option>
          {tiposUnicos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={estadoFiltro} onChange={e => setEstado(e.target.value as any)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">Todos os estados</option>
          <option value="ok">✓ Emitido</option>
          <option value="erro">✗ Com erro</option>
        </select>
        {(q || tipoFiltro || estadoFiltro) && (
          <button onClick={() => { setQ(''); setTipoFiltro(''); setEstado('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Limpar</button>
        )}
      </div>

      {/* Resumo */}
      <div className="flex gap-4 mb-4 text-sm text-gray-500">
        <span>{filtradas.length} registos</span>
        <span className="text-green-600">✓ {emitidas} emitidos</span>
        {comErro > 0 && <span className="text-red-500">✗ {comErro} com erro</span>}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">A carregar...</div>
      ) : ordenadas.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          {q || tipoFiltro || estadoFiltro ? 'Nenhum resultado.' : 'Sem documentos emitidos.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <Th label="ID Excel"        field="fatura_id"/>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Nº Documento</th>
                <Th label="Data submissão"  field="emitido_em"/>
                <Th label="Data documento"  field="data_documento"/>
                <Th label="Cliente"         field="cliente_nome"/>
                <Th label="Total c/IVA"     field="total" right/>
                <Th label="Estado"          field="sucesso"/>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">PDF</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{f.fatura_id || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIPO_COR[f.tipo_documento] || 'bg-gray-100 text-gray-600'}`}>
                      {f.tipo_documento || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-xs text-gray-800">{f.numero_documento || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtTs(f.emitido_em || f.data_submissao)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{f.data_documento || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[160px] truncate" title={f.cliente_nome}>
                    {f.cliente_nome || f.cliente_codigo || '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-gray-800">{fmtEur(f.total)}</td>
                  <td className="px-4 py-3">
                    {f.sucesso
                      ? <span className="text-xs text-green-600 font-medium">✓ Emitido</span>
                      : <span className="text-xs text-red-500 truncate max-w-[100px] block" title={f.erro || ''}>
                          ✗ {f.erro?.substring(0, 25) || 'Erro'}
                        </span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {f.pdf_url
                      ? <a href={f.pdf_url} target="_blank" rel="noreferrer"
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
