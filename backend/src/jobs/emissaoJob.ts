// jobs/emissaoJob.ts — PDFs guardados em /pdfs/ e servidos pelo Express
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import * as admin from 'firebase-admin'
import { db, updateJob, appendJobLog, getConfig } from '../services/firebase'
import { WinmaxRPA } from '../rpa/winmaxRPA'
import { Fatura, LinhaFatura } from '../types'
import { logger } from '../services/logger'

interface LinhaRaw {
  cliente_codigo: string | number
  cliente_nome: string
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
  const mapa = new Map<string, Fatura>()

  for (const raw of linhasRaw) {
    const codigo  = String(raw.cliente_codigo).trim()
    const tipoDoc = String(raw.tipo_documento).trim().toUpperCase()
    const chave   = `${codigo}__${tipoDoc}`
    const linha: LinhaFatura = {
      artigo_ref:     String(raw.artigo_ref).trim().toUpperCase(),
      quantidade:     Number(raw.quantidade),
      preco_unitario: Number(raw.preco_unitario),
      desconto_pct:   Number(raw.desconto_pct ?? 0),
      comentario:     raw.comentario?.toString().trim() || '',
    }
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        cliente_codigo: codigo,
        cliente_nome:   String(raw.cliente_nome).trim(),
        tipo_documento: tipoDoc,
        linhas: [],
      })
    }
    mapa.get(chave)!.linhas.push(linha)
  }
  return Array.from(mapa.values())
}

export async function processarEmissaoJob(jobId: string, excelLocalPath: string): Promise<void> {
  const log = (msg: string) => appendJobLog(jobId, msg).catch(() => {})

  try {
    await updateJob(jobId, { estado: 'ativo', progresso: 0 })
    await log('📂 A ler ficheiro Excel...')

    const faturas = lerExcel(excelLocalPath)
    await log(`📋 ${faturas.length} fatura(s) a emitir`)

    const config = await getConfig()

    // PDFs guardados em /pdfs/{jobId}/ — servidos pelo Express em /api/pdfs/
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

      // URL pública do PDF servida pelo próprio Render
      let pdfUrl: string | null = null
      if (resultado.sucesso && resultado.pdf_url && fs.existsSync(resultado.pdf_url)) {
        const nomeFicheiro = path.basename(resultado.pdf_url)
        pdfUrl = `${backendUrl}/api/pdfs/${jobId}/${encodeURIComponent(nomeFicheiro)}`
      }

      const faturaRef = db().collection('faturas').doc()
      await faturaRef.set({
        job_id:           jobId,
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
      estado:             nok > 0 ? (ok > 0 ? 'concluido' : 'erro') : 'concluido',
      progresso:          100,
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
