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
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
  ])
  await page.waitForTimeout(2000)
  await page.waitForFunction(() => !!document.getElementById('Toolbox_content'), { timeout: 15000 })
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
    timeout?: number
  }
): Promise<string | null> {
  // Abre a listagem dentro do MainPage via iframe (mantém a sessão)
  const iframeId = urlPath.split('/').pop()?.replace('.aspx','') + '_content'
  
  // Injeta a listagem como iframe dentro do MainPage
  await page.evaluate(({ urlPath, company, iframeId, base }: any) => {
    // Remove iframe anterior se existir
    const existente = document.getElementById(iframeId)
    existente?.remove()
    
    // Cria novo iframe
    const iframe = document.createElement('iframe')
    iframe.id = iframeId
    iframe.name = iframeId
    iframe.src = `${base}${urlPath}?CompanyCode=${company}`
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;border:none;'
    document.body.appendChild(iframe)
  }, { urlPath, company, iframeId, base: BASE })

  await page.waitForTimeout(3000)

  // Expande as opções
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonExpand_linkButton1') as HTMLElement)?.click()
  }, iframeId)
  await page.waitForTimeout(1000)

  // Preenche datas
  if (opts?.campoInicio && opts?.campoFim && opts?.di && opts?.df) {
    await page.evaluate(({ id, ci, cf, di, df }: any) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      const from = doc?.getElementById(ci) as HTMLInputElement
      const to   = doc?.getElementById(cf) as HTMLInputElement
      if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
      if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { id: iframeId, ci: opts.campoInicio, cf: opts.campoFim, di: opts.di, df: opts.df })
    await page.waitForTimeout(300)
  }

  // Muda ddlSendTo para Ficheiro via dispatchEvent change
  // (__doPostBack falha mesmo em script injetado porque ScriptManager usa arguments internamente)
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const ddl = doc.getElementById('ddlSendTo') as HTMLSelectElement
    if (!ddl) return
    ddl.selectedIndex = 1  // Ficheiro
    ddl.dispatchEvent(new Event('change', { bubbles: true }))
  }, iframeId)
  await page.waitForTimeout(2000)

  // Selecciona CSV
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    const ddlDoc = doc?.getElementById('ddlDocType') as HTMLSelectElement
    if (ddlDoc) ddlDoc.value = '3'  // Excel (.csv)
  }, iframeId)
  await page.waitForTimeout(300)

  // Aguarda o download
  const downloadPromise = page.waitForEvent('download', { timeout: opts?.timeout || 30000 })

  // Confirma dentro do iframe
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  }, iframeId)

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
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    const context = await browser.newContext({
      locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    await loginWinmax(page, config)
    await log('✅ Login OK')

    const now = admin.firestore.FieldValue.serverTimestamp()

    // Função para commit em batches de 400 (limite Firestore é 500)
    const commitBatches = async (ops: Array<{ col: string; id: string; data: Record<string, unknown> }>) => {
      if (ops.length === 0) { await log('  ⚠️ Sem operações para guardar'); return }
      const SIZE = 400
      for (let i = 0; i < ops.length; i += SIZE) {
        const chunk = ops.slice(i, i + SIZE)
        try {
          const batch = db().batch()
          for (const op of chunk) {
            batch.set(db().collection(op.col).doc(op.id), op.data, { merge: true })
          }
          await batch.commit()
          await log(`  ✅ Batch ${Math.floor(i/SIZE)+1}/${Math.ceil(ops.length/SIZE)} guardado (${chunk.length} docs)`)
        } catch (e) {
          await log(`  ❌ Erro no batch ${Math.floor(i/SIZE)+1}: ${e}`)
          throw e
        }
      }
    }

    // ─── Artigos Existências ───────────────────────────────────────────────
    await log('📦 Artigos Existências (CSV)...')
    const csvArtigos = await exportarCSV(page, '/MReports/Files/ArticleExistences.aspx', company)
    if (csvArtigos) {
      const artigos = parsearCSV(csvArtigos)
      await log(`  → ${artigos.length} artigos`)
      const ops = artigos.flatMap(a => {
        const codigo = a['Código'] || a['Artigo'] || a['Ref'] || a['Referência'] || Object.values(a)[0]
        if (!codigo) return []
        return [{ col: 'artigos', id: String(codigo).replace(/[\/\\]/g,'_'), data: {
          codigo:      String(codigo),
          descricao:   a['Designação'] || a['Descrição'] || a['Nome'] || '',
          taxa_iva:    parseFloat((a['IVA'] || a['Taxa IVA'] || '23').replace(',','.').replace('%','')) || 23,
          preco_venda: parseFloat((a['PVP'] || a['Preço'] || a['P. Venda'] || '0').replace(',','.')) || 0,
          existencias: parseFloat((a['Existências'] || a['Stock'] || a['Qtd'] || a['Quantidade'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }}]
      })
      await commitBatches(ops)
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
      await log(`  → ${vendas.length} vendas`)
      const ops = vendas.flatMap(v => {
        const id = `${v['Nº Doc'] || v['Documento'] || ''}_${v['Data'] || ''}`.replace(/[\/\\]/g,'_')
        if (!id || id === '_') return []
        return [{ col: 'movimentos_venda', id, data: {
          data: v['Data'] || '', numero_doc: v['Nº Doc'] || v['Documento'] || '',
          tipo_doc: v['Tipo'] || '', cliente_codigo: v['Cód. Cliente'] || v['Cliente'] || '',
          cliente_nome: v['Nome'] || v['Entidade'] || '',
          artigo_codigo: v['Artigo'] || v['Código'] || '', artigo_descricao: v['Descrição'] || v['Designação'] || '',
          quantidade: parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',','.')) || 0,
          preco_unitario: parseFloat((v['Preço'] || v['PVP'] || '0').replace(',','.')) || 0,
          total: parseFloat((v['Total'] || v['Líquido'] || v['Valor'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvVendas, { force: true })
    }

    // ─── Compras Movimentos ───────────────────────────────────────────────
    await log('📉 Compras Movimentos (CSV)...')
    const csvCompras = await exportarCSV(page, '/MReports/Transactions/PurchasesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
      timeout: 60000,
    })
    if (csvCompras) {
      const compras = parsearCSV(csvCompras)
      await log(`  → ${compras.length} compras`)
      const ops = compras.flatMap(c => {
        const id = `${c['Nº Doc'] || ''}_${c['Artigo'] || ''}_${c['Data'] || ''}`.replace(/[\/\\]/g,'_')
        if (!id || id === '__') return []
        return [{ col: 'movimentos_compra', id, data: {
          data: c['Data'] || '', numero_doc: c['Nº Doc'] || '', tipo_doc: c['Tipo'] || '',
          fornecedor_codigo: c['Cód. Fornecedor'] || c['Fornecedor'] || '', fornecedor_nome: c['Nome'] || '',
          artigo_codigo: c['Artigo'] || c['Código'] || '', artigo_descricao: c['Descrição'] || c['Designação'] || '',
          quantidade: parseFloat((c['Qtd'] || c['Quantidade'] || '0').replace(',','.')) || 0,
          preco_unitario: parseFloat((c['Preço'] || '0').replace(',','.')) || 0,
          total: parseFloat((c['Total'] || c['Valor'] || '0').replace(',','.')) || 0,
          ultima_sync: now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvCompras, { force: true })
    } else {
      await log('  ⚠️ Sem CSV de compras (timeout ou sem dados)')
    }

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
