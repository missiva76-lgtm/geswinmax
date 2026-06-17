// sync/syncSAFT.ts
// Exporta o SAF-T do WinMax4 e importa para o Firebase
// Seletores confirmados ao vivo em 17/06/2026
//
// Toolbox página 3, Div1 → "Exportar ficheiro SAF-T"
// iframe: utilsExportSAFTFile_content (/MUtils/ExportSAFT.aspx)
// Campos:
//   ddlPeriod: 0=Anual único, 1=Anual mensal, 2=A definir
//   wucCalendarFromDate_txtModernDate / wucCalendarToDate_txtModernDate
//   cbOnlyEntitiesFromDocuments (checkbox)
//   cbOnlyArticlesFromDocuments (checkbox)
//   cbCompressContent (checkbox) → desactivar para XML puro
//   wucButtonConfirm_linkButton1 → abre MessageBox
//   MessageBox: wucButtonYes_linkButton1 → confirma → ProgressBox
//   ProgressBox: utilsExportSAFTFileProgressWindowID_content
//     lblMessage: "O ficheiro SAF-T foi exportado com sucesso"
//     wucButtonOk_linkButton1 → fecha
//   Ficheiro gerado: SAF-T-PT_YYYYMMDD_YYYYMMDD.XML

import { chromium, Browser, Page } from 'playwright'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

interface VendaMes {
  mes: string      // YYYY-MM
  total_liquido: number
  total_iva: number
  num_documentos: number
}

interface SaftResumo {
  periodo: string
  total_vendas: number
  total_iva_vendas: number
  total_compras: number
  num_clientes: number
  num_artigos: number
  vendas_por_mes: VendaMes[]
  top_clientes: { codigo: string; nome: string; total: number }[]
  top_artigos: { codigo: string; descricao: string; total: number }[]
}

async function irParaPaginaToolbox(page: Page, paginaAlvo: number): Promise<void> {
  let tentativas = 0
  while (tentativas < 15) {
    const label = await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 11'
    })
    const actual = parseInt(label.split('/')[0].trim())
    if (actual === paginaAlvo) break
    await page.evaluate((vai: string) => {
      const tb  = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const btn = tb?.contentDocument?.getElementById(vai) as HTMLElement
      btn?.click()
    }, actual < paginaAlvo ? 'LinkButtonNextPage' : 'LinkButtonPrevPage')
    await page.waitForTimeout(500)
    tentativas++
  }
}

async function exportarSAFT(page: Page, dataInicio: string, dataFim: string): Promise<string> {
  // Abre o módulo SAF-T (toolbox página 3, Div1)
  await irParaPaginaToolbox(page, 3)
  await page.evaluate(() => {
    const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
    ;(tb?.contentDocument?.getElementById('Toolbox_ShortcutIconDiv1') as HTMLElement)?.click()
  })
  await page.waitForTimeout(2000)
  await page.waitForFunction(
    () => !!document.getElementById('utilsExportSAFTFile_content'), { timeout: 10000 })

  // Configura o período "A definir" e as datas
  await page.evaluate(({ di, df }: { di: string; df: string }) => {
    const f   = document.getElementById('utilsExportSAFTFile_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return

    const ddl = doc.getElementById('ddlPeriod') as HTMLSelectElement
    ddl.value = '2'  // A definir
    ddl.dispatchEvent(new Event('change', { bubbles: true }))

    const from = doc.getElementById('wucCalendarFromDate_txtModernDate') as HTMLInputElement
    const to   = doc.getElementById('wucCalendarToDate_txtModernDate')   as HTMLInputElement
    if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
    if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }

    // Desmarca compressão para obter XML puro
    const cb = doc.getElementById('cbCompressContent') as HTMLInputElement
    if (cb?.checked) cb.click()
  }, { di: dataInicio, df: dataFim })
  await page.waitForTimeout(300)

  // Confirma exportação
  await page.evaluate(() => {
    const f = document.getElementById('utilsExportSAFTFile_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  })
  await page.waitForTimeout(2000)

  // Confirma o MessageBox ("Confirma a exportação do ficheiro SAF-T?")
  await page.waitForFunction(
    () => !!document.getElementById('UtilsExportSAFT_content'), { timeout: 8000 })
  await page.evaluate(() => {
    const mb = document.getElementById('UtilsExportSAFT_content') as HTMLIFrameElement
    ;(mb?.contentDocument?.getElementById('wucButtonYes_linkButton1') as HTMLElement)?.click()
  })

  // Aguarda o ProgressBox com sucesso
  await page.waitForFunction(
    () => {
      const prog = document.getElementById('utilsExportSAFTFileProgressWindowID_content') as HTMLIFrameElement
      const msg  = prog?.contentDocument?.getElementById('lblMessage')?.innerText?.trim() || ''
      return msg.includes('sucesso')
    },
    { timeout: 60000 }
  )

  // Obtém o nome do ficheiro gerado
  const nomeFicheiro = await page.evaluate(() => {
    const prog = document.getElementById('utilsExportSAFTFileProgressWindowID_content') as HTMLIFrameElement
    const doc  = prog?.contentDocument
    // Clica "<<<" para ver o texto extendido
    ;(doc?.getElementById('wucButtonShowHideExtendedText_buttonText') as HTMLElement)?.closest('a')?.click()
    return ''
  })

  // O ficheiro segue o padrão SAF-T-PT_YYYYMMDD_YYYYMMDD.XML
  const anoInicio = dataInicio.replace(/\//g,'').slice(4) + dataInicio.replace(/\//g,'').slice(0,4).replace(/(\d{2})(\d{2})/, '$1$2')
  return `SAF-T-PT_${dataInicio.replace(/\//g,'')}_${dataFim.replace(/\//g,'')}.XML`
}

function parsearSAFT(xmlContent: string): SaftResumo {
  // Parser básico do SAF-T PT sem xml2js (usa regex para campos principais)
  const getVal = (tag: string, content: string) => {
    const m = content.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`))
    return m?.[1] || ''
  }

  // Extrai todas as invoices
  const invoiceMatches = xmlContent.match(/<Invoice>[\s\S]*?<\/Invoice>/g) || []
  const vendas_por_mes: Record<string, VendaMes> = {}
  let total_vendas = 0
  let total_iva = 0
  const clientes: Record<string, { nome: string; total: number }> = {}
  const artigos: Record<string, { descricao: string; total: number }> = {}

  for (const inv of invoiceMatches) {
    const data  = getVal('InvoiceDate', inv)
    const mes   = data.slice(0, 7)  // YYYY-MM
    const total = parseFloat(getVal('NetTotal', inv) || '0')
    const iva   = parseFloat(getVal('TaxPayable', inv) || '0')
    const custId = getVal('CustomerID', inv)

    total_vendas += total
    total_iva    += iva

    if (!vendas_por_mes[mes]) {
      vendas_por_mes[mes] = { mes, total_liquido: 0, total_iva: 0, num_documentos: 0 }
    }
    vendas_por_mes[mes].total_liquido  += total
    vendas_por_mes[mes].total_iva      += iva
    vendas_por_mes[mes].num_documentos += 1

    if (custId) {
      if (!clientes[custId]) clientes[custId] = { nome: '', total: 0 }
      clientes[custId].total += total
    }
  }

  // Extrai clientes
  const custMatches = xmlContent.match(/<Customer>[\s\S]*?<\/Customer>/g) || []
  for (const c of custMatches) {
    const id   = getVal('CustomerID', c)
    const nome = getVal('CompanyName', c) || getVal('ContactName', c)
    if (id && clientes[id]) clientes[id].nome = nome
  }

  // Extrai artigos dos line items
  const lineMatches = xmlContent.match(/<Line>[\s\S]*?<\/Line>/g) || []
  for (const l of lineMatches) {
    const codigo   = getVal('ProductCode', l)
    const descricao = getVal('Description', l)
    const total    = parseFloat(getVal('CreditAmount', l) || getVal('DebitAmount', l) || '0')
    if (codigo) {
      if (!artigos[codigo]) artigos[codigo] = { descricao, total: 0 }
      artigos[codigo].total += total
    }
  }

  // Conta clientes únicos
  const num_clientes = custMatches.length

  // Conta artigos
  const prodMatches = xmlContent.match(/<Product>[\s\S]*?<\/Product>/g) || []
  const num_artigos = prodMatches.length

  return {
    periodo:          `${getVal('StartDate', xmlContent)} - ${getVal('EndDate', xmlContent)}`,
    total_vendas:     Math.round(total_vendas * 100) / 100,
    total_iva_vendas: Math.round(total_iva * 100) / 100,
    total_compras:    0,  // SAF-T PT foca em vendas
    num_clientes,
    num_artigos,
    vendas_por_mes:   Object.values(vendas_por_mes).sort((a, b) => a.mes.localeCompare(b.mes)),
    top_clientes:     Object.entries(clientes)
      .map(([codigo, v]) => ({ codigo, nome: v.nome, total: Math.round(v.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20),
    top_artigos:      Object.entries(artigos)
      .map(([codigo, v]) => ({ codigo, descricao: v.descricao, total: Math.round(v.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20),
  }
}

export async function syncSAFT(
  dataInicio?: string,
  dataFim?: string,
  jobId?: string
): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config = await getConfig()
  const ano    = new Date().getFullYear()

  // Default: desde 01/01/ano actual até hoje
  const di = dataInicio || `01/01/${ano}`
  const df = dataFim    || new Date().toLocaleDateString('pt-PT').replace(/\//g, '/')

  await log(`📊 Sync SAF-T: ${di} → ${df}`)

  const pastaSAFT = path.join(process.cwd(), 'saft')
  fs.mkdirSync(pastaSAFT, { recursive: true })

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      locale: 'pt-PT',
      timezoneId: 'Europe/Lisbon',
      acceptDownloads: true,
    })
    const page = await context.newPage()

    // Login
    const url = `https://app102.winmax4.com/Default.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.fill('#txtUserCode', config.utilizador || '')
    await page.fill('#txtPassword', config.password   || '')
    await page.click('#btnLogin')
    await page.waitForLoadState('networkidle')
    await log('✅ Login OK')

    // Interceta o download do SAF-T
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 })

    await exportarSAFT(page, di, df)

    // Descarrega o ficheiro XML
    const download   = await downloadPromise
    const nomeFicheiro = download.suggestedFilename() || `SAFT_${di.replace(/\//g,'')}_${df.replace(/\//g,'')}.xml`
    const caminhoLocal = path.join(pastaSAFT, nomeFicheiro)
    await download.saveAs(caminhoLocal)
    await log(`📥 SAF-T descarregado: ${nomeFicheiro}`)

    // Lê e parseia o XML
    const xmlContent = fs.readFileSync(caminhoLocal, 'utf-8')
    const resumo     = parsearSAFT(xmlContent)
    await log(`📊 ${resumo.vendas_por_mes.length} meses | ${resumo.num_clientes} clientes | ${resumo.num_artigos} artigos`)

    // Guarda o resumo no Firestore
    const periodo = `${di.replace(/\//g,'-')}_${df.replace(/\//g,'-')}`
    await db().collection('saft').doc(periodo).set({
      ...resumo,
      ficheiro:     nomeFicheiro,
      importado_em: admin.firestore.FieldValue.serverTimestamp(),
      periodo_inicio: di,
      periodo_fim:    df,
    }, { merge: true })

    // Guarda também os dados mensais para o dashboard
    const batch = db().batch()
    for (const mes of resumo.vendas_por_mes) {
      const ref = db().collection('saft_mensal').doc(mes.mes)
      batch.set(ref, {
        ...mes,
        ultima_sync: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    await batch.commit()

    await db().collection('sync_log').add({
      tipo:        'saft',
      periodo,
      total_vendas: resumo.total_vendas,
      total_iva:    resumo.total_iva_vendas,
      executado_em: admin.firestore.FieldValue.serverTimestamp(),
      estado:       'ok',
    })

    await log(`✅ SAF-T importado: vendas ${resumo.total_vendas.toFixed(2)}€`)

  } catch (err) {
    logger.error(`❌ Sync SAF-T: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'saft', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    throw err
  } finally {
    await browser?.close()
  }
}
