// sync/syncArtigos.ts — v6
// Exporta as listagens em formato CSV usando o campo ddlDocType
// Seletores confirmados ao vivo:
//   ddlSendTo: '1' = Ficheiro
//   ddlDocType: '3' = Excel (.csv)  /  '1' = Excel (.xls)
//   __doPostBack('ddlSendTo', '') para activar o select de formato

import { chromium, Browser, Page, Download } from 'playwright'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

const BASE = 'https://app102.winmax4.com'

async function loginWinmax(page: Page, config: any): Promise<void> {
  const url = `${BASE}/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  await page.waitForFunction(
    () => !!document.getElementById('UserAuthentication_content'),
    { timeout: 15000 }
  )

  await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
    const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    const u   = doc?.getElementById('txtUserLogin')    as HTMLInputElement
    const p   = doc?.getElementById('txtUserPassword') as HTMLInputElement
    if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
    if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { user: config.utilizador || '', pass: config.password || '' })

  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
}

// Abre uma listagem, muda para CSV e faz download
async function exportarCSV(
  page: Page,
  urlPath: string,
  company: string,
  opts?: {
    campoInicio?: string
    campoFim?: string
    di?: string
    df?: string
    expandir?: boolean
  }
): Promise<string | null> {
  const fullUrl = `${BASE}${urlPath}?CompanyCode=${company}`
  await page.goto(fullUrl, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1000)

  // Clica Expandir se necessário para mostrar mais campos
  if (opts?.expandir !== false) {
    await page.evaluate(() => {
      ;(document.getElementById('wucButtonExpand_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForTimeout(800)
  }

  // Preenche datas se existirem
  if (opts?.campoInicio && opts?.campoFim && opts?.di && opts?.df) {
    await page.evaluate(({ ci, cf, di, df }: any) => {
      const from = document.getElementById(ci) as HTMLInputElement
      const to   = document.getElementById(cf) as HTMLInputElement
      if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
      if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { ci: opts.campoInicio, cf: opts.campoFim, di: opts.di, df: opts.df })
    await page.waitForTimeout(300)
  }

  // Muda "Enviar para" para "Ficheiro" usando selectOption do Playwright
  try {
    await page.selectOption('#ddlSendTo', '1')  // Ficheiro
    await page.waitForTimeout(1500)  // Aguarda o postback ASP.NET
  } catch { /* campo pode não existir */ }

  // Selecciona formato CSV
  try {
    await page.selectOption('#ddlDocType', '3')  // Excel (.csv)
    await page.waitForTimeout(300)
  } catch { /* campo pode não existir ainda */ }

  // Aguarda o download
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 })

  // Confirma
  await page.evaluate(() => {
    ;(document.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  })

  try {
    const download: Download = await downloadPromise
    const nome = download.suggestedFilename() || `sync_${Date.now()}.csv`
    const tmpPath = path.join(process.cwd(), 'tmp', nome)
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true })
    await download.saveAs(tmpPath)
    logger.info(`  Download: ${nome} (${fs.statSync(tmpPath).size} bytes)`)
    return tmpPath
  } catch (err) {
    logger.warn(`  Sem download: ${err}`)
    return null
  }
}

// Parseia CSV e devolve array de objectos
function parsearCSV(csvPath: string): Record<string, string>[] {
  const content = fs.readFileSync(csvPath, 'latin1')  // WinMax4 usa encoding latin1
  const linhas  = content.split('\n').map(l => l.trim()).filter(l => l)

  if (linhas.length < 2) return []

  // Detecta separador (ponto-e-vírgula ou vírgula)
  const sep = linhas[0].includes(';') ? ';' : ','

  const headers = linhas[0].split(sep).map(h => h.replace(/"/g, '').trim())

  return linhas.slice(1).map(linha => {
    const cells = linha.split(sep).map(c => c.replace(/"/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] || '' })
    return obj
  }).filter(l => Object.values(l).some(v => v))
}

export async function syncWinmax(jobId?: string): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config  = await getConfig()
  const company = config.company_code || 'AUTOAVENIDA'
  const dataInicio = (config.sync_data_inicio || '01-01-2000').replace(/-/g, '/')
  const dataFim    = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g,'-')).replace(/-/g,'/')

  await log(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    await loginWinmax(page, config)
    await log('✅ Login OK')

    const now = admin.firestore.FieldValue.serverTimestamp()
    const batch = db().batch()

    // ─── Artigos Existências ───────────────────────────────────────────────
    await log('📦 Artigos Existências (CSV)...')
    const csvArtigos = await exportarCSV(page, '/MReports/Files/ArticleExistences.aspx', company)
    if (csvArtigos) {
      const artigos = parsearCSV(csvArtigos)
      await log(`  → ${artigos.length} artigos | headers: ${Object.keys(artigos[0] || {}).join(', ')}`)

      for (const a of artigos) {
        const codigo = a['Código'] || a['Artigo'] || a['Ref'] || a['Referência'] || Object.values(a)[0]
        if (!codigo) continue
        batch.set(db().collection('artigos').doc(String(codigo).replace(/[\/\\]/g,'_')), {
          codigo:      String(codigo),
          descricao:   a['Designação'] || a['Descrição'] || a['Nome'] || '',
          taxa_iva:    parseFloat((a['IVA'] || a['Taxa IVA'] || '23').replace(',','.').replace('%','')) || 23,
          preco_venda: parseFloat((a['PVP'] || a['Preço'] || a['P. Venda'] || '0').replace(',','.')) || 0,
          existencias: parseFloat((a['Existências'] || a['Stock'] || a['Qtd'] || a['Quantidade'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }, { merge: true })
      }
      fs.rmSync(csvArtigos, { force: true })
    } else {
      await log('  ⚠️ Sem ficheiro CSV')
    }

    // ─── Vendas Documentos ────────────────────────────────────────────────
    await log('📈 Vendas Documentos (CSV)...')
    const csvVendas = await exportarCSV(page, '/MReports/Transactions/SalesIssuedDocuments.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
    })
    if (csvVendas) {
      const vendas = parsearCSV(csvVendas)
      await log(`  → ${vendas.length} vendas | headers: ${Object.keys(vendas[0] || {}).join(', ')}`)

      for (const v of vendas) {
        const id = `${v['Nº Doc'] || v['Documento'] || ''}_${v['Data'] || ''}`.replace(/[\/\\]/g,'_')
        if (!id || id === '_') continue
        batch.set(db().collection('movimentos_venda').doc(id), {
          data: v['Data'] || '', numero_doc: v['Nº Doc'] || v['Documento'] || '',
          tipo_doc: v['Tipo'] || '', cliente_codigo: v['Cód. Cliente'] || v['Cliente'] || '',
          cliente_nome: v['Nome'] || v['Entidade'] || '',
          artigo_codigo: v['Artigo'] || v['Código'] || '', artigo_descricao: v['Descrição'] || v['Designação'] || '',
          quantidade: parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',','.')) || 0,
          preco_unitario: parseFloat((v['Preço'] || v['PVP'] || '0').replace(',','.')) || 0,
          total: parseFloat((v['Total'] || v['Líquido'] || v['Valor'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }, { merge: true })
      }
      fs.rmSync(csvVendas, { force: true })
    }

    // ─── Compras Movimentos ───────────────────────────────────────────────
    await log('📉 Compras Movimentos (CSV)...')
    const csvCompras = await exportarCSV(page, '/MReports/Transactions/PurchasesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
    })
    if (csvCompras) {
      const compras = parsearCSV(csvCompras)
      await log(`  → ${compras.length} compras | headers: ${Object.keys(compras[0] || {}).join(', ')}`)

      for (const c of compras) {
        const id = `${c['Nº Doc'] || ''}_${c['Artigo'] || ''}_${c['Data'] || ''}`.replace(/[\/\\]/g,'_')
        if (!id || id === '__') continue
        batch.set(db().collection('movimentos_compra').doc(id), {
          data: c['Data'] || '', numero_doc: c['Nº Doc'] || '', tipo_doc: c['Tipo'] || '',
          fornecedor_codigo: c['Cód. Fornecedor'] || c['Fornecedor'] || '', fornecedor_nome: c['Nome'] || '',
          artigo_codigo: c['Artigo'] || c['Código'] || '', artigo_descricao: c['Descrição'] || c['Designação'] || '',
          quantidade: parseFloat((c['Qtd'] || c['Quantidade'] || '0').replace(',','.')) || 0,
          preco_unitario: parseFloat((c['Preço'] || '0').replace(',','.')) || 0,
          total: parseFloat((c['Total'] || c['Valor'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }, { merge: true })
      }
      fs.rmSync(csvCompras, { force: true })
    }

    if ((csvArtigos || csvVendas || csvCompras)) await batch.commit()

    await db().collection('sync_log').add({
      tipo: 'winmax_completa', data_inicio: dataInicio, data_fim: dataFim,
      executado_em: now, estado: 'ok',
    })

    await log('✅ Sync concluída')

  } catch (err) {
    logger.error(`❌ Sync: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    if (jobId) await appendJobLog(jobId, `❌ ${err}`).catch(() => {})
  } finally {
    await browser?.close()
  }
}
