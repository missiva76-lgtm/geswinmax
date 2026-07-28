import { useState, useEffect } from 'react'
import { Search, FileText, RefreshCw, ChevronUp, ChevronDown, Loader2, Trash2, AlertTriangle } from 'lucide-react'
import { getFaturas, limparHistorico } from '../services/api'
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
  emitido_em?: { seconds?: number; _seconds?: number }
  data_submissao?: { seconds?: number; _seconds?: number }
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

// CORRIGIDO 27/07/2026: o Firestore (firebase-admin v13) serializa Timestamp como
// {"_seconds": ..., "_nanoseconds": ...} — COM underscore. Esta função só lia
// ".seconds" (sem underscore), pelo que as colunas "Data submissão" e "Data
// documento" mostravam sempre "—", mesmo quando a data existia realmente.
const fmtTs = (ts?: { seconds?: number; _seconds?: number }) => {
  const s = ts?.seconds ?? ts?._seconds
  if (!s) return '—'
  return new Date(s * 1000).toLocaleDateString('pt-PT', {
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
  const [pdfEmCurso, setPdfEmCurso]   = useState<string | null>(null)
  const [pdfErro, setPdfErro]         = useState<string | null>(null)
  const [verLimpar, setVerLimpar]     = useState(false)
  const [aLimpar, setALimpar]         = useState(false)
  const [msgLimpeza, setMsgLimpeza]   = useState<string | null>(null)

  const executarLimpeza = async (modo: 'erros' | 'tudo') => {
    setALimpar(true)
    setMsgLimpeza(null)
    try {
      const r = await limparHistorico(modo)
      setMsgLimpeza(r.completo
        ? `✅ ${r.apagados} registo(s) apagado(s)`
        : `⚠️ ${r.apagados} registo(s) apagado(s), mas ainda restam alguns — volta a clicar para continuar`)
      setVerLimpar(false)
      carregar()
    } catch (e: any) {
      setMsgLimpeza(`❌ Falhou: ${e.message}`)
    } finally {
      setALimpar(false)
    }
  }

  // CORRIGIDO 28/07/2026: era um link direto <a href target="_blank">. Como o PDF
  // está no Firebase Storage (origem diferente do site), o browser IGNORA o atributo
  // `download` em ligações de origem cruzada e limita-se a abrir o ficheiro numa aba
  // — em vez de o guardar na pasta de transferências. É exatamente o mesmo problema
  // que já tínhamos corrigido na página de Emissão: busca-se o ficheiro, cria-se um
  // blob local, e a partir daí o download é tratado como qualquer outro.
  const descarregarPDF = async (f: FaturaEmitida) => {
    if (!f.pdf_url || pdfEmCurso) return
    const chave = f.numero_documento || f.fatura_id || f.pdf_url
    setPdfErro(null)
    setPdfEmCurso(chave)
    try {
      const res = await fetch(f.pdf_url)
      if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const nome = `${f.tipo_documento ? f.tipo_documento + '_' : ''}${(f.numero_documento || f.fatura_id || 'documento').replace(/\//g, '_')}.pdf`
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = nome
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: any) {
      setPdfErro(`Não foi possível descarregar o PDF — ${e.message}`)
    } finally {
      setPdfEmCurso(null)
    }
  }

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
      case 'emitido_em':     va = a.emitido_em?.seconds ?? a.emitido_em?._seconds ?? 0; vb = b.emitido_em?.seconds ?? b.emitido_em?._seconds ?? 0; break
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Histórico de emissões</h2>
          <p className="text-sm text-gray-400">Documentos emitidos via GesWinmax</p>
        </div>
        <div className="flex gap-2">
          <button onClick={carregar}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
            Atualizar
          </button>
          {faturas.length > 0 && (
            <button onClick={() => { setMsgLimpeza(null); setVerLimpar(true) }}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1.5">
              <Trash2 size={14}/>
              Limpar histórico
            </button>
          )}
        </div>
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
      {msgLimpeza && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs border flex items-start justify-between gap-3 ${
          msgLimpeza.startsWith('✅')
            ? 'bg-green-50 border-green-200 text-green-700'
            : msgLimpeza.startsWith('⚠️')
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{msgLimpeza}</span>
          <button onClick={() => setMsgLimpeza(null)} className="opacity-60 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      {verLimpar && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !aLimpar && setVerLimpar(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-50 shrink-0">
                <AlertTriangle size={18} className="text-red-500"/>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Limpar histórico de emissões</h3>
                <p className="text-xs text-gray-500 mt-0.5">Esta ação é permanente e não pode ser anulada.</p>
              </div>
            </div>

            <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <strong>Atenção:</strong> este histórico é também o que impede a emissão de faturas
              duplicadas. Se apagares os registos com sucesso, reenviar o mesmo Excel volta a emitir
              tudo de novo no WinMax4, sem aviso.
            </div>

            <div className="space-y-2">
              <button onClick={() => executarLimpeza('erros')} disabled={aLimpar}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                <p className="text-sm font-medium text-gray-800">Limpar apenas os registos com erro</p>
                <p className="text-xs text-gray-500 mt-0.5">Recomendado — mantém a proteção contra duplicados</p>
              </button>

              <button onClick={() => executarLimpeza('tudo')} disabled={aLimpar}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                <p className="text-sm font-medium text-red-700">Limpar tudo</p>
                <p className="text-xs text-red-600 mt-0.5">Apaga também os emitidos com sucesso e a proteção contra duplicados</p>
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => setVerLimpar(false)} disabled={aLimpar}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
                {aLimpar ? 'A apagar...' : 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pdfErro && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start justify-between gap-3">
          <span>{pdfErro}</span>
          <button onClick={() => setPdfErro(null)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      <div className="flex gap-4 mb-4 text-sm text-gray-500 flex-wrap">
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <Th label="ID Excel"        field="fatura_id"/>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Nº Documento</th>
                <Th label="Data submissão"  field="emitido_em"/>
                <Th label="Data documento"  field="data_documento"/>
                <Th label="Cliente"         field="cliente_nome"/>
                <Th label="Total s/IVA"     field="total" right/>
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
                      ? <button onClick={() => descarregarPDF(f)}
                          disabled={pdfEmCurso !== null}
                          className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs disabled:opacity-40 disabled:cursor-wait">
                          {pdfEmCurso === (f.numero_documento || f.fatura_id || f.pdf_url)
                            ? <><Loader2 size={12} className="animate-spin"/> ...</>
                            : <><FileText size={12}/> PDF</>}
                        </button>
                      : <span className="text-gray-300 text-xs">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
