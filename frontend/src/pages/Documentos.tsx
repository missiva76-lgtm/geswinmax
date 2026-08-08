import { useState, useEffect, useRef } from 'react'
import { Search, RefreshCw, Download, ChevronUp, ChevronDown, Receipt } from 'lucide-react'
import * as XLSX from 'xlsx'
import { getDocumentos, triggerSyncDocumentos } from '../services/api'
import ServerWakingBanner from '../components/ServerWakingBanner'

const API = import.meta.env.VITE_API_URL || '/api'

interface Documento {
  id: string
  tipo_documento: string
  numero_documento: string
  data: string
  data_vencimento?: string
  cliente_codigo?: string
  cliente_nome?: string
  cliente_nif?: string
  total: number
  total_liquidado: number
  por_pagar: number
  liquidado: boolean
  moeda?: string
  utilizador?: string
}

type SortField = 'data' | 'tipo_documento' | 'numero_documento' | 'cliente_nome' | 'total' | 'por_pagar' | 'data_vencimento'
type SortDir = 'asc' | 'desc'

const TIPO_COR: Record<string, string> = {
  FAA: 'bg-blue-100 text-blue-700',
  FR:  'bg-green-100 text-green-700',
  FS:  'bg-teal-100 text-teal-700',
  FRB: 'bg-purple-100 text-purple-700',
  FTB: 'bg-orange-100 text-orange-700',
  NCC: 'bg-red-100 text-red-700',
  NBB: 'bg-pink-100 text-pink-700',
  VDD: 'bg-amber-100 text-amber-700',
  VDB: 'bg-lime-100 text-lime-700',
}

const fmtEur = (v?: number | null) =>
  v != null ? `${Number(v).toFixed(2).replace('.', ',')} €` : '—'

const fmtData = (d?: string) => {
  if (!d) return '—'
  const p = d.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d
}

/** Uma dívida está vencida se a data de vencimento já passou. */
const estaVencido = (doc: Documento) => {
  if (doc.liquidado || !doc.data_vencimento) return false
  return doc.data_vencimento < new Date().toISOString().slice(0, 10)
}

export default function Documentos() {
  const [docs, setDocs]             = useState<Documento[]>([])
  const [loading, setLoading]       = useState(true)
  const [q, setQ]                   = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [estadoFiltro, setEstado]   = useState<'' | 'liquidados' | 'porliquidar'>('')
  const [dataInicio, setDI]         = useState('')
  const [dataFim, setDF]            = useState('')
  const [sortField, setSortField]   = useState<SortField>('data')
  const [sortDir, setSortDir]       = useState<SortDir>('desc')
  const [page, setPage]             = useState(1)
  const [syncing, setSyncing]       = useState(false)
  const [syncLog, setSyncLog]       = useState<string[]>([])
  const [serverError, setServerError] = useState<Error | null>(null)
  const logRef                      = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 50

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [syncLog])

  const carregar = async () => {
    setLoading(true)
    try {
      const res = await getDocumentos()
      setDocs(res)
      setServerError(null)
    } catch (e: any) { setServerError(e) }
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncLog([])
    try {
      const { jobId } = await triggerSyncDocumentos()
      // A listagem é reimportada por inteiro (o estado de liquidação muda com o
      // tempo), pelo que pode demorar alguns minutos.
      const poll = async (n = 0): Promise<void> => {
        if (n > 300) {
          setSyncing(false)
          setSyncLog(l => [...l, '⚠️ A demorar mais do que o esperado — verifica o Dashboard'])
          return
        }
        const job = await fetch(`${API}/jobs/${jobId}`).then(r => r.json()).catch(() => null)
        if (job?.log) setSyncLog(job.log)
        if (job?.estado === 'erro' && job?.erro_geral) {
          setSyncLog(l => l.some(x => x.includes(job.erro_geral)) ? l : [...l, `❌ ${job.erro_geral}`])
        }
        if (job?.estado === 'concluido' || job?.estado === 'erro') {
          setSyncing(false)
          if (job?.estado === 'concluido') carregar()
          return
        }
        setTimeout(() => poll(n + 1), 3000)
      }
      poll()
    } catch (e: any) {
      setSyncing(false)
      setSyncLog([`❌ Não foi possível iniciar: ${e.message}`])
    }
  }

  const tipos = Array.from(new Set(docs.map(d => d.tipo_documento).filter(Boolean))).sort()

  const filtrados = docs.filter(d => {
    if (tipoFiltro && d.tipo_documento !== tipoFiltro) return false
    if (estadoFiltro === 'liquidados' && !d.liquidado) return false
    if (estadoFiltro === 'porliquidar' && d.liquidado) return false
    if (dataInicio && d.data < dataInicio) return false
    if (dataFim && d.data > dataFim) return false
    if (q) {
      const qs = q.toLowerCase()
      return (
        d.numero_documento?.toLowerCase().includes(qs) ||
        d.cliente_nome?.toLowerCase().includes(qs) ||
        d.cliente_codigo?.toLowerCase().includes(qs) ||
        d.cliente_nif?.toLowerCase().includes(qs)
      )
    }
    return true
  })

  const ordenados = [...filtrados].sort((a, b) => {
    const va: any = (a as any)[sortField] ?? ''
    const vb: any = (b as any)[sortField] ?? ''
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE))
  const paginaAtual = Math.min(page, totalPaginas)
  const visiveis = ordenados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE)

  const totalizar = (lista: Documento[]) => ({
    total: Math.round(lista.reduce((s, d) => s + (d.total || 0), 0) * 100) / 100,
    porPagar: Math.round(lista.reduce((s, d) => s + (d.por_pagar || 0), 0) * 100) / 100,
  })
  const totais = totalizar(filtrados)
  const nPorLiquidar = filtrados.filter(d => !d.liquidado).length
  const nVencidos = filtrados.filter(estaVencido).length

  const handleSort = (f: SortField) => {
    if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
    setPage(1)
  }

  const handleExport = () => {
    const dados = ordenados.map(d => ({
      'Tipo': d.tipo_documento,
      'Nº Documento': d.numero_documento,
      'Data': fmtData(d.data),
      'Vencimento': fmtData(d.data_vencimento),
      'Cód. Cliente': d.cliente_codigo || '',
      'Cliente': d.cliente_nome || '',
      'NIF': d.cliente_nif || '',
      'Total': d.total,
      'Já pago': d.total_liquidado,
      'Por pagar': d.por_pagar,
      'Estado': d.liquidado ? 'Liquidado' : (estaVencido(d) ? 'Vencido' : 'Por liquidar'),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Documentos')
    XLSX.writeFile(wb, `documentos_emitidos_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const Th = ({ label, field, right }: { label: string; field: SortField; right?: boolean }) => (
    <th onClick={() => handleSort(field)}
      className={`px-4 py-2.5 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none ${right ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortField === field && (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)}
      </span>
    </th>
  )

  return (
    <div className="flex-1 overflow-auto p-6">
      <ServerWakingBanner error={serverError} onRetry={carregar}/>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Documentos emitidos</h2>
          <p className="text-sm text-gray-400">Estado de liquidação dos documentos do WinMax4</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {docs.length > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              <Download size={13}/> Exportar Excel
            </button>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
            {syncing ? 'A importar...' : 'Importar do WinMax4'}
          </button>
        </div>
      </div>

      {(syncing || syncLog.length > 0) && (
        <div ref={logRef} className="mb-4 bg-gray-900 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs">
          {syncing && syncLog.length === 0 && (
            <div className="text-gray-300">A iniciar importação...</div>
          )}
          {syncLog.map((linha, i) => (
            <div key={i} className={
              linha.includes('❌') ? 'text-red-400' :
              linha.includes('✅') ? 'text-green-400' :
              linha.includes('⚠️') ? 'text-yellow-400' : 'text-gray-300'}>
              {linha}
            </div>
          ))}
        </div>
      )}

      {/* Totais */}
      {docs.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Documentos', valor: String(filtrados.length), cor: 'text-gray-800' },
            { label: 'Total faturado', valor: fmtEur(totais.total), cor: 'text-gray-800' },
            { label: 'Por liquidar', valor: `${nPorLiquidar} doc.`, cor: nPorLiquidar > 0 ? 'text-amber-600' : 'text-gray-800' },
            { label: 'Em dívida', valor: fmtEur(totais.porPagar), cor: totais.porPagar > 0 ? 'text-red-600' : 'text-green-600' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-0.5">{k.label}</p>
              <p className={`text-lg font-semibold ${k.cor}`}>{k.valor}</p>
            </div>
          ))}
        </div>
      )}

      {nVencidos > 0 && (
        <p className="text-xs text-red-600 mb-3">
          ⚠️ {nVencidos} documento(s) com vencimento ultrapassado
        </p>
      )}

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300"/>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }}
            placeholder="Pesquisar por nº documento, cliente, NIF..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        </div>
        <select value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600">
          <option value="">Todos os tipos</option>
          {tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={estadoFiltro} onChange={e => { setEstado(e.target.value as any); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600">
          <option value="">Todos os estados</option>
          <option value="porliquidar">Por liquidar</option>
          <option value="liquidados">Liquidados</option>
        </select>
        <input type="date" value={dataInicio} onChange={e => { setDI(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"/>
        <input type="date" value={dataFim} onChange={e => { setDF(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"/>
        {(q || tipoFiltro || estadoFiltro || dataInicio || dataFim) && (
          <button onClick={() => { setQ(''); setTipoFiltro(''); setEstado(''); setDI(''); setDF(''); setPage(1) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Limpar</button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-8">A carregar...</p>}

      {!loading && docs.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <Receipt size={32} className="mx-auto mb-3 text-gray-300"/>
          <p className="text-sm text-gray-500">Sem documentos importados.</p>
          <p className="text-xs text-gray-400 mt-1">Clica em "Importar do WinMax4" para começar.</p>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <Th label="Tipo"        field="tipo_documento"/>
                  <Th label="Nº Doc."     field="numero_documento"/>
                  <Th label="Data"        field="data"/>
                  <Th label="Vencimento"  field="data_vencimento"/>
                  <Th label="Cliente"     field="cliente_nome"/>
                  <Th label="Total"       field="total" right/>
                  <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Já pago</th>
                  <Th label="Por pagar"   field="por_pagar" right/>
                  <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visiveis.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COR[d.tipo_documento] || 'bg-gray-100 text-gray-600'}`}>
                        {d.tipo_documento}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{d.numero_documento}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{fmtData(d.data)}</td>
                    <td className={`px-4 py-2.5 text-xs ${estaVencido(d) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {fmtData(d.data_vencimento)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[220px] truncate" title={d.cliente_nome || ''}>
                      {d.cliente_nome || <span className="text-gray-300">consumidor final</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 text-right">{fmtEur(d.total)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right">{fmtEur(d.total_liquidado)}</td>
                    <td className={`px-4 py-2.5 text-xs text-right font-medium ${d.por_pagar > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                      {d.por_pagar > 0 ? fmtEur(d.por_pagar) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {d.liquidado
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">Liquidado</span>
                        : estaVencido(d)
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">Vencido</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Por liquidar</span>}
                    </td>
                  </tr>
                ))}
                {visiveis.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                    Sem documentos para os filtros selecionados.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-t border-gray-50 bg-gray-50">
              <span className="text-xs text-gray-400">
                {ordenados.length} documento(s) · página {paginaAtual} de {totalPaginas}
              </span>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                  className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 disabled:opacity-40">Anterior</button>
                <button onClick={() => setPage(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                  className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 disabled:opacity-40">Seguinte</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
