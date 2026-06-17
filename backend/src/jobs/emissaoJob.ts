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

    const linha: LinhaFatura = {
      artigo_ref:     String(raw.artigo_ref).trim().toUpperCase(),
      quantidade:     Number(raw.quantidade),
      preco_unitario: Number(raw.preco_unitario),
      desconto_pct:   Number(raw.desconto_pct ?? 0),
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

  try {
    await updateJob(jobId, { estado: 'ativo', progresso: 0 })
    await log('📂 A ler ficheiro Excel...')

    const faturas = lerExcel(excelLocalPath)
    await log(`📋 ${faturas.length} fatura(s) a emitir`)

    const config = await getConfig()

    const pastaBase = path.join(process.cwd(), 'pdfs')
    const pastaPDFs = path.join(pastaBase, jobId)
    fs.mkdirSync(pastaPDFs, { recursive: true })

    const rpa = new WinmaxRPA({
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

    const resultados = await rpa.processarFaturas(faturas, async (pct, resultado) => {
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
        numero_documento: resultado.numero_documento || null,
        pdf_url:          pdfUrl,
        sucesso:          resultado.sucesso,
        total_linhas:     resultado.total_linhas,
        linhas_ok:        resultado.linhas_ok,
        erro:             resultado.erro || null,
        erros_linhas:     resultado.erros_linhas || [],
        duracao_ms:       resultado.duracao_ms || 0,
        emitido_em:       admin.firestore.FieldValue.serverTimestamp(),
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
      'resultado.erros':    nok,
      'resultado.faturas':  resultados,
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    })

    await log(`✅ Concluído: ${ok} emitidas, ${nok} erros`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Job ${jobId} falhou: ${msg}`)
    await updateJob(jobId, {
      estado:     'erro',
      erro_geral: msg,
      concluido_em: admin.firestore.FieldValue.serverTimestamp(),
    })
    await log(`❌ Erro crítico: ${msg}`)
  }
}
