// sync/syncArquivoDigital.ts
// Seletores confirmados ao vivo em 17/06/2026
//
// Fluxo:
// 1. Login
// 2. Toolbox página 1 → Div5 (Arquivo digital) → clica
//    iframe: utilsDigitalArchive_content
// 3. Clica ibDetailsDocuments
//    iframe: DigitalArchiveDetails_content (/MUtils/DigitalArchiveDetails.aspx)
// 4. Filtro data: FilterContentDate_txtFrom1_1 / FilterContentDate_txtTo1_1
// 5. Clica Filtrar: wucFileList1_wucButtonFilter_linkButton1
// 6. Paginação: wucFileList1_ibNext / wucFileList1_ibPrev
//    Contador: wucFileList1_divpager → wucFileList1_DIVModernPageCounter
// 7. Tabela: wucFileList1_fileList (colunas: Data, Informação, Ficheiro, Tamanho)
// 8. Download PDF: clica lnkSelect de cada linha → download interceptado

import { chromium, Browser, Page } from 'playwright'
import { acquireBrowserLock } from '../services/browserLock'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'
import { clicarToolboxPorTitulo } from '../rpa/toolboxHelper'

interface DocArquivo {
  data: string
  informacao: string
  cliente?: string
  cliente_nome?: string
  cliente_codigo?: string
  total_liquido: number | null
  ficheiro: string
  tamanho: string
  tipo_documento: string
  numero_documento: string
  ano: string
}

// Extrai tipo e nº do nome do ficheiro
// 20260612_FFF_518.pdf      → tipo=FFF, numero=518
// 20260615_FTB_2026_48.pdf  → tipo=FTB, numero=2026/48
function parseFicheiro(ficheiro: string): { tipo: string; numero: string; ano: string } {
  const nome  = ficheiro.replace('.pdf', '').replace('.PDF', '')
  const partes = nome.split('_')
  const ano  = partes[0]?.substring(0, 4) || ''
  const tipo = partes[1] || ''
  const num  = partes.slice(2).join('/') || ''
  return { tipo, numero: num, ano }
}

async function abrirArquivoDigital(page: Page): Promise<void> {
  // Procura "Arquivo digital" pelo título — robusto a mudanças de página/índice
  const found = await clicarToolboxPorTitulo(page, 'Arquivo digital')
  if (!found) throw new Error('Atalho "Arquivo digital" não encontrado no Toolbox')
  await page.waitForTimeout(2000)
  await page.waitForFunction(
    () => !!document.getElementById('utilsDigitalArchive_content'),
    { timeout: 60000 }
  )
}

async function abrirDetalhesDocumentos(page: Page): Promise<void> {
  await page.evaluate(() => {
    const f = document.getElementById('utilsDigitalArchive_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('ibDetailsDocuments') as HTMLElement)?.click()
  })
  await page.waitForTimeout(2000)
  await page.waitForFunction(
    () => !!document.getElementById('DigitalArchiveDetails_content'),
    { timeout: 10000 }
  )
}

async function aplicarFiltroData(page: Page, dataInicio: string, dataFim: string): Promise<void> {
  await page.evaluate(({ di, df }: { di: string; df: string }) => {
    const f   = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const from = doc.getElementById('FilterContentDate_txtFrom1_1') as HTMLInputElement
    const to   = doc.getElementById('FilterContentDate_txtTo1_1')   as HTMLInputElement
    if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
    if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { di: dataInicio, df: dataFim })
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    const f = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucFileList1_wucButtonFilter_linkButton1') as HTMLElement)?.click()
  })
  await page.waitForTimeout(2500)
}

async function getPaginaInfo(page: Page): Promise<{ actual: number; total: number }> {
  return page.evaluate(() => {
    const f      = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
    const doc    = f?.contentDocument
    const pager  = doc?.getElementById('wucFileList1_divpager')
    const texto  = pager?.innerText?.trim() || ''
    const match  = texto.match(/(\d+)\s*\/\s*(\d+)/)
    return match
      ? { actual: parseInt(match[1]), total: parseInt(match[2]) }
      : { actual: 1, total: 1 }
  })
}

async function extrairLinhas(page: Page): Promise<DocArquivo[]> {
  return page.evaluate(() => {
    const f    = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
    const doc  = f?.contentDocument
    const grid = doc?.getElementById('wucFileList1_fileList') as HTMLTableElement
    if (!grid) return []

    return Array.from(grid.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'))
        .map(td => (td as HTMLTableCellElement).innerText.trim())
      // colunas: (select) | Data | Informação | Ficheiro | Tamanho | (apagar)
      // "Informação" tem formato: "FTB 2026/48\nNome do cliente\n141,92 EUR"
      const informacao = cells[2] || ''
      const linhasInfo = informacao.split('\n').map((s: string) => s.trim()).filter(Boolean)
      // Primeira linha: "FTB 2025/93" → tipo + numero
      const primLinha = linhasInfo[0] || ''
      const tipoNum = primLinha.match(/^([A-Z]+)\s+(\d{4}\/\d+)/)
      const tipo_documento   = tipoNum?.[1] || ''
      const numero_documento = tipoNum?.[2] || primLinha
      const ano              = numero_documento.split('/')[0] || ''
      // Segunda linha: nome do cliente
      const cliente_nome = linhasInfo[1] || ''
      // Última linha com EUR: total
      const totalStr = linhasInfo.find((l: string) => /[\d,.]+\s*EUR/.test(l)) || ''
      const totalNum = parseFloat(totalStr.replace(/[^\d,.]/g,'').replace(',','.')) || null

      return {
        data:       cells[1] || '',
        informacao,
        cliente_nome,
        cliente_codigo: '',
        total_liquido: totalNum,
        ficheiro:   cells[3] || '',
        tamanho:    cells[4] || '',
        tipo_documento,
        numero_documento,
        ano,
      }
    }).filter((r: any) => r.ficheiro)
  })
}

async function irProximaPagina(page: Page): Promise<boolean> {
  const paginaAntes = await getPaginaInfo(page)
  await page.evaluate(() => {
    const f = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucFileList1_ibNext') as HTMLElement)?.click()
  })
  await page.waitForTimeout(1500)
  const paginaDepois = await getPaginaInfo(page)
  return paginaDepois.actual > paginaAntes.actual
}

export async function syncArquivoDigital(jobId?: string, options?: { forceReimport?: boolean }): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config  = await getConfig()
  const dataInicio = config.sync_data_inicio || '01-01-2000'
  const dataFim    = config.sync_data_fim ||
    new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')

  // Converte para formato dd/mm/yyyy que o WinMax4 usa
  const toWinmax = (d: string) => d.replace(/-/g, '/')

  await log(`📁 Sync Arquivo Digital: ${dataInicio} → ${dataFim}`)

  const pastaPDFs = path.join(process.cwd(), 'pdfs', 'arquivo')
  fs.mkdirSync(pastaPDFs, { recursive: true })

  let browser: Browser | null = null

  try {
    releaseLock = await acquireBrowserLock()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    const context = await browser.newContext({
      locale: 'pt-PT',
      timezoneId: 'Europe/Lisbon',
      acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    // Login
// Login WinMax4
    // O WinMax4 abre sempre no MainPage com um iframe de autenticação UserAuthentication_content
    // Campos: txtUserLogin / txtUserPassword — botão: wucButtonConfirm_linkButton1
    const url = `https://app102.winmax4.com/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)

    // Aguarda o iframe de autenticação
    await page.waitForFunction(
      () => !!document.getElementById('UserAuthentication_content'),
      { timeout: 60000 }
    )

    // Preenche no iframe de autenticação
    await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
      const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return
      const u = doc.getElementById('txtUserLogin')   as HTMLInputElement
      const p = doc.getElementById('txtUserPassword') as HTMLInputElement
      if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
      if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { user: config.utilizador || '', pass: config.password || '' })
    await page.waitForTimeout(500)

    // Clica Confirmar
    await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await log('✅ Login OK')

    await abrirArquivoDigital(page)
    await log('📂 Arquivo Digital aberto')

    await abrirDetalhesDocumentos(page)
    await log('📄 Lista de documentos aberta')

    await aplicarFiltroData(page, toWinmax(dataInicio), toWinmax(dataFim))

    const { total } = await getPaginaInfo(page)
    await log(`📋 ${total} página(s)`)

    // Documentos já importados (sync incremental)
    const forceReimport = options?.forceReimport || false
    let existentes = new Set<string>()
    if (!forceReimport) {
      const existentesSnap = await db().collection('arquivo').select('ficheiro').get()
      existentes = new Set(existentesSnap.docs.map(d => d.data().ficheiro))
      await log(`📥 ${existentes.size} já importados`)
    } else {
      await log('🔄 Reimportação forçada — a reimportar todos os documentos')
    }

    const backendUrl = process.env.BACKEND_URL || 'https://geswinmax-backend.onrender.com'
    let totalImportados = 0
    let pagina = 1

    while (true) {
      const linhas = await extrairLinhas(page)
      const novas  = linhas.filter(l => l.ficheiro && !existentes.has(l.ficheiro))
      await log(`  Pág. ${pagina}/${total}: ${linhas.length} docs (${novas.length} novos)`)

      for (const linha of novas) {
        const { tipo, numero, ano } = parseFicheiro(linha.ficheiro)
        linha.tipo_documento   = tipo
        linha.numero_documento = numero
        linha.ano              = ano

        // Guarda metadados sem descarregar PDF (demasiado lento para todos os documentos)
        // O PDF pode ser descarregado on-demand via /api/arquivo/:id/pdf
        const docId = linha.ficheiro.replace(/[.\/\\]/g, '_')
        // Converte data "31/12/2025 21:03:52" para timestamp
        let dataTs: admin.firestore.Timestamp | null = null
        try {
          const [datePart, timePart] = (linha.data || '').split(' ')
          const [d, m, y] = (datePart || '').split('/')
          if (d && m && y) {
            dataTs = admin.firestore.Timestamp.fromDate(new Date(`${y}-${m}-${d}T${timePart || '00:00:00'}`))
          }
        } catch { /**/ }

        await db().collection('arquivo').doc(docId).set({
          ...linha,
          pdf_url:      null,
          data_ts:      dataTs,
          importado_em: admin.firestore.FieldValue.serverTimestamp(),
          fonte:        'arquivo_digital_winmax',
        }, { merge: true })

        existentes.add(linha.ficheiro)
        totalImportados++
      }

      const temProxima = await irProximaPagina(page)
      if (!temProxima || pagina >= total) break
      pagina++
    }

    await db().collection('sync_log').add({
      tipo:             'arquivo_digital',
      data_inicio:      dataInicio,
      data_fim:         dataFim,
      total_importados: totalImportados,
      executado_em:     admin.firestore.FieldValue.serverTimestamp(),
      estado:           'ok',
    })

    await log(`✅ Arquivo Digital: ${totalImportados} documentos importados`)

  } catch (err) {
    logger.error(`❌ Sync Arquivo Digital: ${err}`)
    await db().collection('sync_log').add({
      tipo:  'arquivo_digital', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    throw err
  } finally {
    await browser?.close()
  }
}
