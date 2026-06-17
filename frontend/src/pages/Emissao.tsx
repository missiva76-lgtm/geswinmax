import { useState, useCallback } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Loader2, ExternalLink, Download } from 'lucide-react'
import { uploadExcel } from '../services/api'
import { useJob } from '../hooks/useJob'
import { FaturaResultado } from '../types'

export default function Emissao() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [erro, setErro] = useState('')
  const job = useJob(jobId)

  const processarFicheiro = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setErro('Ficheiro inválido. Usa .xlsx, .xls ou .csv')
      return
    }
    setErro('')
    try {
      const { jobId: id } = await uploadExcel(file)
      setJobId(id)
    } catch (e) {
      setErro(`Erro ao submeter: ${e}`)
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processarFicheiro(file)
  }

  const faturas: FaturaResultado[] = job?.resultado?.faturas || []
  const emitidas = faturas.filter(f => f.sucesso)
  const comErro  = faturas.filter(f => !f.sucesso)

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Emissão de faturas</h2>
      <p className="text-sm text-gray-500 mb-6">Deposita o ficheiro Excel para iniciar o processamento automático.</p>

      {!jobId && (
        <>
          {/* Zona de drop */}
          <div
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer
              ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
            onClick={() => document.getElementById('fileInput')?.click()}>
            <Upload size={32} className="mx-auto mb-3 text-gray-300"/>
            <p className="text-sm font-medium text-gray-700">Arrasta o Excel aqui ou clica para selecionar</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx · .xls · .csv</p>
            <input id="fileInput" type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files?.[0] && processarFicheiro(e.target.files[0])}/>
          </div>

          {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}

          <div className="mt-4 flex items-center gap-3">
            <FileSpreadsheet size={14} className="text-gray-400 shrink-0"/>
            <span className="text-xs text-gray-400">Templates:</span>
            <a href="/template-faturas.xlsx" download
              className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <Download size={11}/> Excel (.xlsx)
            </a>
            <span className="text-gray-200">|</span>
            <a href="/template-faturas.csv" download
              className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <Download size={11}/> CSV (.csv)
            </a>
          </div>

          {/* Colunas do Excel */}
          <div className="mt-5 bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">Colunas do Excel</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[
                { col: 'fatura_id',      obrig: true,  desc: 'Identifica o documento (ex: F1, F2, F3...)' },
                { col: 'cliente_codigo', obrig: true,  desc: 'Nº cliente WinMax4' },
                { col: 'cliente_nome',   obrig: true,  desc: 'Nome (para relatório)' },
                { col: 'tipo_documento', obrig: true,  desc: 'FAA, FR, FS, FTB, NCC, GT' },
                { col: 'artigo_ref',     obrig: true,  desc: 'Ref. artigo WinMax4' },
                { col: 'quantidade',     obrig: true,  desc: 'Qtd.' },
                { col: 'preco_unitario', obrig: true,  desc: 'Preço sem IVA' },
                { col: 'desconto_pct',   obrig: false, desc: 'Desconto %' },
                { col: 'comentario',     obrig: false, desc: 'Texto adicional na linha' },
              ].map(({ col, obrig, desc }) => (
                <div key={col} className="flex items-start gap-1.5 py-1 border-b border-gray-50">
                  <code className="bg-gray-50 px-1.5 py-0.5 rounded text-gray-700 shrink-0">{col}</code>
                  <span className="text-gray-400 shrink-0">{obrig ? '✅' : '⬜'}</span>
                  <span className="text-gray-500">{desc}</span>
                </div>
              ))}
            </div>

            {/* Exemplo */}
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-xs font-medium text-blue-700 mb-2">Exemplo — mesmo cliente, 2 faturas separadas:</p>
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-blue-600">
                    <th className="text-left pr-3">fatura_id</th>
                    <th className="text-left pr-3">cliente_codigo</th>
                    <th className="text-left pr-3">tipo_documento</th>
                    <th className="text-left">artigo_ref</th>
                  </tr>
                </thead>
                <tbody className="text-blue-800 font-mono">
                  <tr><td className="pr-3">F1</td><td className="pr-3">82</td><td className="pr-3">FAA</td><td>SERV REB</td></tr>
                  <tr><td className="pr-3">F1</td><td className="pr-3">82</td><td className="pr-3">FAA</td><td>SERV MEC</td></tr>
                  <tr className="text-orange-700"><td className="pr-3">F2</td><td className="pr-3">82</td><td className="pr-3">FAA</td><td>PECAS</td></tr>
                  <tr><td className="pr-3">F3</td><td className="pr-3">100</td><td className="pr-3">FR</td><td>SERV ADM</td></tr>
                </tbody>
              </table>
              <p className="text-xs text-blue-600 mt-2">F1 e F2 são do mesmo cliente mas emitidas como documentos separados. F3 é outro cliente.</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">Descrição e IVA vêm automaticamente da ficha do artigo no WinMax4.</p>
          </div>
        </>
      )}

      {/* Estado do Job em tempo real */}
      {job && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {job.estado === 'ativo'     && <Loader2     size={16} className="text-blue-500 animate-spin"/>}
              {job.estado === 'concluido' && <CheckCircle size={16} className="text-green-500"/>}
              {job.estado === 'erro'      && <XCircle     size={16} className="text-red-500"/>}
              <span className="text-sm font-medium text-gray-900 capitalize">{job.estado}</span>
            </div>
            <button onClick={() => setJobId(null)}
              className="text-xs text-blue-600 hover:underline">Nova emissão</button>
          </div>

          {/* Barra de progresso */}
          <div className="px-5 py-3 border-b border-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>Progresso</span><span>{job.progresso}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${job.progresso}%` }}/>
            </div>
            {job.resultado && (
              <div className="flex gap-4 mt-2">
                <span className="text-xs text-green-600">✓ {job.resultado.emitidas} emitidas</span>
                {job.resultado.erros > 0 &&
                  <span className="text-xs text-red-500">✗ {job.resultado.erros} erros</span>}
              </div>
            )}
          </div>

          {/* Log */}
          <div className="px-5 py-3 border-b border-gray-50">
            <p className="text-xs font-medium text-gray-500 mb-2">Log</p>
            <div className="bg-gray-900 rounded-lg p-3 h-32 overflow-y-auto font-mono text-xs">
              {job.log.slice(-20).map((linha, i) => (
                <div key={i} className={
                  linha.includes('❌') ? 'text-red-400' :
                  linha.includes('✅') ? 'text-green-400' :
                  linha.includes('⚠️') ? 'text-yellow-400' : 'text-gray-300'}>
                  {linha}
                </div>
              ))}
            </div>
          </div>

          {/* Resultados */}
          {faturas.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-3">Documentos processados</p>
              <div className="space-y-2">
                {emitidas.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-2 border-b border-gray-50">
                    <CheckCircle size={14} className="text-green-500 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800">{f.numero_documento}</span>
                      <span className="text-gray-400 ml-2 text-xs">{f.cliente_nome}</span>
                      <span className="text-gray-300 ml-1 text-xs">({f.fatura_id})</span>
                    </div>
                    {f.pdf_url && (
                      <a href={f.pdf_url} target="_blank" rel="noreferrer"
                        className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs shrink-0">
                        PDF <ExternalLink size={11}/>
                      </a>
                    )}
                  </div>
                ))}
                {comErro.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-gray-50">
                    <XCircle size={14} className="text-red-500 shrink-0 mt-0.5"/>
                    <div className="min-w-0">
                      <span className="font-medium text-gray-800">{f.cliente_nome}</span>
                      <span className="text-xs text-gray-400 ml-2">({f.fatura_id} · {f.tipo_documento})</span>
                      <p className="text-xs text-red-500 mt-0.5 truncate">{f.erro}</p>
                      {f.erros_linhas?.map((e, j) => (
                        <p key={j} className="text-xs text-red-400 mt-0.5">
                          Linha {e.linha} [{e.artigo_ref}]: {e.mensagem}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
