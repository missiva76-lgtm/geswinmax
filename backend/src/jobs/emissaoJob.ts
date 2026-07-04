// jobs/emissaoJob.ts
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import * as admin from 'firebase-admin'
import { db, updateJob, appendJobLog, getConfig } from '../services/firebase'
import { WinmaxRPA } from '../rpa/winmaxRPA'
import { Fatura, LinhaFatura } from '../types'
import { logger } from '../services/logger'

interface LinhaRaw {
  fatura_id: string | number       // agrupa linhas na mesma fatura
  cliente_codigo: string | number
  cliente_nome?: string            // opcional — se não vier, fica em branco (o WinMax4 tem o nome)
  tipo_documento: string
  artigo_ref: string
  quantidade: number
  preco_unitario: number
  desconto_pct?: number
  comentario?: string
}

// CORRIGIDO 04/07/2026: chave usada para detetar faturas já emitidas com sucesso
// anteriormente, evitando duplicados se o mesmo Excel for reenviado (ex: depois de
// um lote parar a meio por falha do browser). Usa fatura_id + cliente_codigo +
// tipo_documento, normalizados (trim + maiúsculas) para evitar falsos negativos
// por diferenças de capitalização/espaços.
function chaveDedup(fatura_id: string, cliente_codigo: string, tipo_documento: string): string {
  return `${String(fatura_id).trim().toUpperCase()}|${String(cliente_codigo).trim().toUpperCase()}|${String(tipo_documento).trim().toUpperCase()}`
}

function lerExcel(caminho: string): Fatura[] {
  const wb = XLSX.readFile(caminho)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const linhasRaw = XLSX.utils.sheet_to_json<LinhaRaw>(ws, { raw: true })

  if (!linhasRaw.length) throw new Error('Ficheiro sem dados')

  // Valida colunas obrigatórias
  const obrigatorias = ['fatura_id', 'cliente_codigo', 'tipo_documento', 'artigo_ref', 'quantidade', 'preco_unitario']
  for (const col of obrigatorias) {
    if (!(col in linhasRaw[0])) throw new Error(`Coluna obrigatória em falta: "${col}"`)
  }

  // Agrupa por fatura_id — cada fatura_id único = um documento separado
  // Preserva a ordem de inserção (Map mantém ordem)
  const mapa = new Map<string, Fatura>()

  for (const raw of linhasRaw) {
    const faturaId = String(raw.fatura_id).trim()
    if (!faturaId) throw new Error(`fatura_id vazio na linha com artigo "${raw.artigo_ref}"`)

    // CORRIGIDO 03/07/2026: Number("0,4") devolve NaN — o JS só entende ponto como
    // separador decimal. Se o Excel guardar um valor como TEXTO com vírgula portuguesa
    // (comum quando o utilizador digita diretamente na célula), o preço/quantidade
    // chegava como NaN ao RPA, que por sua vez escrevia "NaN" no campo do WinMax4 —
    // o campo rejeitava silenciosamente e revertia para 0, reproduzindo exatamente
    // o sintoma do bug antigo (preço/quantidade a zero) mesmo com o RPA já corrigido.
    const paraNumero = (v: unknown, nomeCampo: string): number => {
      if (typeof v === 'number') return v
      if (v === undefined || v === null || String(v).trim() === '') return 0
      const normalizado = String(v).trim().replace(',', '.')
      const n = Number(normalizado)
      if (Number.isNaN(n)) {
        logger.warn(`⚠️ Linha "${raw.artigo_ref}": ${nomeCampo}="${v}" não é um número válido — a usar 0`)
        return 0
      }
      return n
    }

    const linha: LinhaFatura = {
      artigo_ref:     String(raw.artigo_ref).trim().toUpperCase(),
      quantidade:     paraNumero(raw.quantidade, 'quantidade'),
      preco_unitario: paraNumero(raw.preco_unitario, 'preco_unitario'),
      desconto_pct:   paraNumero(raw.desconto_pct, 'desconto_pct'),
      comentario:     raw.comentario?.toString().trim() || '',
    }

    if (!mapa.has(faturaId)) {
      mapa.set(faturaId, {
        fatura_id:      faturaId,
        cliente_codigo: String(raw.cliente_codigo).trim(),
        cliente_nome:   raw.cliente_nome ? String(raw.cliente_nome).trim() : '',
        tipo_documento: String(raw.tipo_documento).trim().toUpperCase(),
        linhas: [],
      })
    }
    mapa.get(faturaId)!.linhas.push(linha)
  }

  const faturas = Array.from(mapa.values())
  logger.info(`📂 ${linhasRaw.length} linha(s) → ${faturas.length} fatura(s):`)
  faturas.forEach((f, i) =>
    logger.info(`   [${i+1}] ${f.fatura_id} | ${f.cliente_nome} (${f.cliente_codigo}) | ${f.tipo_documento} | ${f.linhas.length} linha(s)`)
  )
  return faturas
}

export async function processarEmissaoJob(jobId: string, excelLocalPath: string): Promise<void> {
  const log = (msg: string) => appendJobLog(jobId, msg).catch(() => {})
  let rpa: WinmaxRPA | null = null

  try {
    await updateJob(jobId, { estado: 'ativo', progresso: 0 })
    await log('📂 A ler ficheiro Excel...')

    const faturas = lerExcel(excelLocalPath)
    await log(`📋 ${faturas.length} fatura(s) a emitir`)

    // CORRIGIDO 04/07/2026: se o mesmo Excel for reenviado (ex: depois de um lote parar
    // a meio por falha do browser — ver overlay_modal preso), as faturas já emitidas com
    // sucesso seriam emitidas OUTRA VEZ no WinMax4, criando documentos duplicados. Agora
    // verifica-se, antes de começar, quais das faturas do Excel já foram emitidas com
    // sucesso anteriormente (mesma fatura_id + cliente_codigo + tipo_documento), e essas
    // são ignoradas em vez de reprocessadas.
    const chaves = faturas.map(f => chaveDedup(f.fatura_id, f.cliente_codigo, f.tipo_documento))
    const jaEmitidas = new Set<string>()
    // Firestore limita cláusulas 'in' a 30 valores — divide em blocos se necessário
    for (let i = 0; i < chaves.length; i += 30) {
      const bloco = chaves.slice(i, i + 30)
      if (bloco.length === 0) continue
      const snap = await db().collection('faturas').where('chave_dedup', 'in', bloco).get()
      snap.docs.forEach(d => {
        const dados = d.data()
        if (dados.sucesso === true && dados.chave_dedup) jaEmitidas.add(dados.chave_dedup)
      })
    }

    const faturasParaEmitir: Fatura[] = []
    let duplicadasIgnoradas = 0
    for (const f of faturas) {
      const chave = chaveDedup(f.fatura_id, f.cliente_codigo, f.tipo_documento)
      if (jaEmitidas.has(chave)) {
        duplicadasIgnoradas++
        await log(`⏭️ Fatura ${f.fatura_id} (cliente ${f.cliente_codigo}, ${f.tipo_documento}) já emitida anteriormente com sucesso — a ignorar`)
      } else {
        faturasParaEmitir.push(f)
      }
    }
    if (duplicadasIgnoradas > 0) {
      await log(`⏭️ ${duplicadasIgnoradas} fatura(s) ignorada(s) por já terem sido emitidas com sucesso`)
    }

    if (faturasParaEmitir.length === 0) {
      await log('✅ Nenhuma fatura nova a emitir — todas já tinham sido processadas com sucesso anteriormente')
      fs.rmSync(excelLocalPath, { force: true })
      await updateJob(jobId, {
        estado:                 'concluido',
        progresso:              100,
        'resultado.total':      faturas.length,
        'resultado.emitidas':   0,
        'resultado.ignoradas':  duplicadasIgnoradas,
        'resultado.erros':      0,
        'resultado.faturas':    [],
        concluido_em: admin.firestore.FieldValue.serverTimestamp(),
      })
      return
    }

    const config = await getConfig()

    const pastaBase = path.join(process.cwd(), 'pdfs')
    const pastaPDFs = path.join(pastaBase, jobId)
    fs.mkdirSync(pastaPDFs, { recursive: true })

    rpa = new WinmaxRPA({
      winmaxUrl:       config.winmax_url || 'https://app102.winmax4.com',
      companyCode:     config.company_code || 'AUTOAVENIDA',
      utilizador:      config.utilizador || '',
      password:        config.password || '',
      templatePDF:     config.template_pdf || '5046\\Auto_avenida233.rpx',
      pastaDestinoPDF: pastaPDFs,
      jobId,
    })

    await rpa.iniciar()
    await rpa.login()

    const backendUrl = process.env.BACKEND_URL || 'https://geswinmax-backend.onrender.com'

    const resultados = await rpa.processarFaturas(faturasParaEmitir, async (pct, resultado) => {
      await updateJob(jobId, { progresso: pct })

      let pdfUrl: string | null = null
      if (resultado.sucesso && resultado.pdf_url && fs.existsSync(resultado.pdf_url)) {
        const nomeFicheiro = path.basename(resultado.pdf_url)
        pdfUrl = `${backendUrl}/api/pdfs/${jobId}/${encodeURIComponent(nomeFicheiro)}`
      }

      await db().collection('faturas').doc().set({
        job_id:           jobId,
        fatura_id:        resultado.fatura_id,
        cliente_codigo:   resultado.cliente_codigo,
        cliente_nome:     resultado.cliente_nome,
        tipo_documento:   resultado.tipo_documento,
        chave_dedup:      chaveDedup(resultado.fatura_id, resultado.cliente_codigo, resultado.tipo_documento),
        numero_documento: resultado.numero_documento || null,
        data_documento:   resultado.data_documento || null,
        pdf_url:          pdfUrl,
        sucesso:          resultado.sucesso,
        total_linhas:     resultado.total_linhas,
        linhas_ok:        resultado.linhas_ok,
        erro:             resultado.erro || null,
        erros_linhas:     resultado.erros_linhas || [],
        duracao_ms:       resultado.duracao_ms || 0,
        total:            resultado.total || null,
        emitido_em:       admin.firestore.FieldValue.serverTimestamp(),
        data_submissao:   admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    await rpa.fechar()
    fs.rmSync(excelLocalPath, { force: true })

    const ok  = resultados.filter(r => r.sucesso).length
    const nok = resultados.length - ok

    await updateJob(jobId, {
      estado:               nok > 0 ? (ok > 0 ? 'concluido' : 'erro') : 'concluido',
      progresso:            100,
      'resultado.total':    faturas.length,
      'resultado.emitidas': ok,
      'resultado.ignoradas': duplicadasIgnoradas,
      'resultado.erros':    nok,
      'resultado.faturas':  resultados,
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    })

    await log(`✅ Concluído: ${ok} emitidas, ${nok} erros${duplicadasIgnoradas > 0 ? `, ${duplicadasIgnoradas} ignoradas (duplicadas)` : ''}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Job ${jobId} falhou: ${msg}`)
    await updateJob(jobId, {
      estado:     'erro',
      erro_geral: msg,
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    })
    await log(`❌ Erro crítico: ${msg}`)
    // Garantir que o browser é sempre fechado e o lock libertado
    await rpa?.fechar().catch(() => {})
  }
}
