// sync/syncArtigos.ts — v6
// Exporta as listagens em formato CSV usando o campo ddlDocType
// Seletores confirmados ao vivo:
//   ddlSendTo: '1' = Ficheiro
//   ddlDocType: '3' = Excel (.csv)  /  '1' = Excel (.xls)
//   __doPostBack('ddlSendTo', '') para activar o select de formato

import { chromium, Browser, Page, Download } from 'playwright'
import { acquireBrowserLock } from '../services/browserLock'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

const BASE = 'https://app102.winmax4.com'

async function loginWinmax(page: Page, config: any): Promise<void> {
  const url = `${BASE}/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
  console.log('[Sync] A navegar para WinMax4...')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  console.log('[Sync] Página carregada, a aguardar UserAuthentication_content...')
  await page.waitForTimeout(3000)

  await page.waitForFunction(
    () => !!document.getElementById('UserAuthentication_content'),
    { timeout: 90000 }
  )
  console.log('[Sync] UserAuthentication_content encontrado')

  await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
    const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    const u   = doc?.getElementById('txtUserLogin')    as HTMLInputElement
    const p   = doc?.getElementById('txtUserPassword') as HTMLInputElement
    if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
    if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { user: config.utilizador || '', pass: config.password || '' })

  console.log('[Sync] Credenciais preenchidas, a clicar Confirmar...')
  await page.waitForTimeout(300)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
      console.log('[Sync] waitForNavigation falhou (pode ser normal):', e.message)
    }),
    page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
  ])
  console.log('[Sync] Pós-login, a aguardar Toolbox_content...')
  await page.waitForTimeout(3000)
  
  // Verifica se ainda está no ecrã de login (credenciais erradas)
  const aindaLogin = await page.evaluate(() => !!document.getElementById('UserAuthentication_content')).catch(() => false)
  if (aindaLogin) {
    const erro = await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      return f?.contentDocument?.body?.innerText?.substring(0, 200) || ''
    }).catch(() => '')
    console.log('[Sync] AINDA no ecrã de login! Texto:', erro)
  }
  
  await page.waitForFunction(() => !!document.getElementById('Toolbox_content'), { timeout: 90000 })
  console.log('[Sync] Toolbox_content encontrado — login OK')
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
  const downloadPromise = page.waitForEvent('download', { timeout: opts?.timeout || 60000 })

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
  let linhas    = content.split('\n').map(l => l.trim()).filter(l => l)

  if (linhas.length < 2) return []

  // Remove linha "sep=," ou "sep=;" que o WinMax4 adiciona para compatibilidade Excel
  if (linhas[0].startsWith('sep=')) linhas = linhas.slice(1)

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

export async function syncWinmax(jobId?: string, opts?: { forceCompleto?: boolean }): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config  = await getConfig()
  const company = config.company_code || 'AUTOAVENIDA'

  let dataInicio = (config.sync_data_inicio || '01-01-2000').replace(/-/g, '/')
  const dataFim = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g,'-')).replace(/-/g,'/')

  if (!opts?.forceCompleto) {
    // Sync incremental: usa a data da última sync bem-sucedida (menos 2 dias de margem)
    const ultimaSyncSnap = await db().collection('sync_log')
      .where('tipo', '==', 'winmax_completa')
      .orderBy('criado_em', 'desc')
      .limit(1)
      .get()
      .catch(() => null)

    if (ultimaSyncSnap && !ultimaSyncSnap.empty) {
      const ultima = ultimaSyncSnap.docs[0].data()
      const ultimaData = ultima.criado_em?.toDate?.() || null
      if (ultimaData) {
        const margem = new Date(ultimaData)
        margem.setDate(margem.getDate() - 2)
        const incrementalStr = margem.toLocaleDateString('pt-PT')
        const [di, mi, yi] = dataInicio.split('/').map(Number)
        const dataInicioObj = new Date(yi, mi - 1, di)
        if (margem > dataInicioObj) {
          dataInicio = incrementalStr
        }
      }
    }
    await log(`🔄 Sync WinMax4 (incremental): ${dataInicio} → ${dataFim}`)
  } else {
    await log(`🔄 Sync WinMax4 (COMPLETO): ${dataInicio} → ${dataFim}`)
  }

  let browser: Browser | null = null
  let releaseLock: (() => void) | null = null
  try {
    releaseLock = await acquireBrowserLock()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    const context = await browser.newContext({
      locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    await loginWinmax(page, config)
    await log('✅ Login OK')

    const now = admin.firestore.FieldValue.serverTimestamp()

    // Função para commit em batches (tamanho reduzido + pausa entre batches para não sobrecarregar Firestore)
    const commitBatches = async (ops: Array<{ col: string; id: string; data: Record<string, unknown> }>) => {
      if (ops.length === 0) { await log('  ⚠️ Sem operações para guardar'); return }
      const SIZE = 250
      for (let i = 0; i < ops.length; i += SIZE) {
        const chunk = ops.slice(i, i + SIZE)
        try {
          const batch = db().batch()
          for (const op of chunk) {
            batch.set(db().collection(op.col).doc(op.id), op.data, { merge: true })
          }
          await Promise.race([
            batch.commit(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 45s no batch')), 45000))
          ])
          await log(`  ✅ Batch ${Math.floor(i/SIZE)+1}/${Math.ceil(ops.length/SIZE)} guardado (${chunk.length} docs)`)
        } catch (e) {
          await log(`  ⚠️ Batch ${Math.floor(i/SIZE)+1} falhou (a continuar): ${e}`)
        }
        // Pequena pausa entre batches para aliviar pressão sobre o Firestore
        await new Promise(r => setTimeout(r, 500))
      }
    }

    // ─── Artigos Existências ───────────────────────────────────────────────
    await log('📦 Artigos Existências (CSV)...')
    const csvArtigos = await exportarCSV(page, '/MReports/Files/ArticleExistences.aspx', company)
    if (csvArtigos) {
      const artigos = parsearCSV(csvArtigos)
      await log(`  → ${artigos.length} artigos | TODOS headers: ${Object.keys(artigos[0] || {}).join(' | ')}`)
      const artigoTeste = artigos.find(a => a['ArticleCode'] === '0.009.4683.0') || artigos[10] || artigos[0]
      if (artigoTeste) await log(`  → Stock/Preço (${artigoTeste['ArticleCode']}): ${JSON.stringify({CurrentStock: artigoTeste['CurrentStock'], ArticleBatchCurrentStock: artigoTeste['ArticleBatchCurrentStock'], SalePrice1: artigoTeste['SalePrice1WithoutTaxesFees'], NetCost: artigoTeste['NetCostPrice'], IsActive: artigoTeste['IsActive']})}`)
      const ops = artigos.flatMap(a => {
        const codigo = a['ArticleCode'] || a['Code'] || a['Código'] || a['Artigo'] || a['Ref'] || a['Referência'] || Object.values(a)[0]
        if (!codigo) return []
        // Taxa IVA — vem no campo PurchaseTaxesToShow ou similar (ex: "23.00")
        const taxaIva = parseFloat((a['PurchaseTaxesToShow'] || a['SaleTaxesToShow'] || '23').replace(',','.')) || 23
        const precoSemIva = parseFloat((a['SalePrice1WithoutTaxesFees'] || '0').replace(',','.')) || 0
        const precoComIva = precoSemIva * (1 + taxaIva / 100)
        return [{ col: 'artigos', id: String(codigo).replace(/[\/\\]/g,'_'), data: {
          codigo:           String(codigo),
          descricao:        a['ArticleDesignation'] || '',
          familia:          a['FamilyDesignation'] || '',
          sub_familia:      a['SubFamilyDesignation'] || '',
          tipo:             a['ArticleType'] || '',
          ativo:            a['IsActive'] === 'True' || a['IsActive'] === '1',
          unidade:          a['StockUnitCode'] || '',
          stock:            parseFloat((a['CurrentStock'] || a['Stock'] || a['ArticleBatchCurrentStock'] || '0').replace(',','.')) || 0,
          preco_custo:      parseFloat((a['NetCostPrice'] || '0').replace(',','.')) || 0,
          preco_sem_iva:    precoSemIva,
          preco_com_iva:    Math.round(precoComIva * 100) / 100,
          preco_venda:      precoSemIva,
          taxa_iva:         taxaIva,
          ultima_sync:      now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvArtigos, { force: true })
    } else {
      await log('  ⚠️ Sem ficheiro CSV')
    }

    // ─── Vendas por Artigo ────────────────────────────────────────────────
    await log('📈 Vendas por Artigo (CSV)...')
    // Limpa coleção antes de reimportar (evita registos órfãos de syncs antigas com mapeamento diferente)
    await log('  🗑️ A limpar movimentos_venda antigos...')
    let totalRemovidosVenda = 0
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const snap = await db().collection('movimentos_venda').limit(400).get().catch(() => null)
      if (!snap || snap.empty) break
      const delBatch = db().batch()
      snap.docs.forEach(d => delBatch.delete(d.ref))
      await delBatch.commit().catch(() => {})
      totalRemovidosVenda += snap.size
    }
    if (totalRemovidosVenda > 0) await log(`  🗑️ ${totalRemovidosVenda} registos de vendas antigos removidos`)
    const csvVendas = await exportarCSV(page, '/MReports/Transactions/SalesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
    })
    if (csvVendas) {
      const vendas = parsearCSV(csvVendas)
      await log(`  → ${vendas.length} linhas vendas | headers: ${Object.keys(vendas[0] || {}).join(' | ')}`)
      if (vendas[0]) await log(`  → Exemplo: ${JSON.stringify(Object.entries(vendas[0]).slice(0,8))}`)
      const ops = vendas.flatMap(v => {
        const id = `${v['Document'] || v['DocumentID'] || ''}_${v['ArticleCode'] || ''}_${v['DocumentDate'] || ''}`.split('/').join('_')
        if (!v['DocumentDate'] || !v['ArticleCode']) return []
        const qtd = parseFloat((v['Quantity'] || '0').replace(',','.')) || 0
        const precoUnitSemIva = parseFloat((v['UnitaryPriceWithoutTaxesAfterDiscounts'] || '0').replace(',','.')) || 0
        // O campo "Total" do CSV SalesArticleMovements é SEM IVA (confirmado: ≈ preço unit. x qtd)
        const totalSemIva = parseFloat((v['Total'] || '0').replace(',','.')) || (precoUnitSemIva * qtd)
        const taxaIva = parseFloat((v['TaxFeeRatePercentage'] || '23').replace(',','.')) || 23
        const totalComIva = Math.round(totalSemIva * (1 + taxaIva / 100) * 100) / 100
        return [{ col: 'movimentos_venda', id, data: {
          data:             v['DocumentDate'] || '',
          numero_doc:       v['Document'] || v['DocumentID'] || '',
          cliente_codigo:   v['EntityCode'] || '',
          cliente_nome:     v['EntityName'] || '',
          artigo_codigo:    v['ArticleCode'] || '',
          artigo_descricao: v['ArticleDesignation'] || '',
          familia:          v['FamilyDesignation'] || '',
          quantidade:       qtd,
          preco_unitario:   precoUnitSemIva,
          total:            totalComIva,
          total_sem_iva:    Math.round(totalSemIva * 100) / 100,
          vendedor:         v['SalesPersonName'] || '',
          ultima_sync:      now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvVendas, { force: true })
    } else {
      await log('  ⚠️ Sem CSV de vendas (timeout ou sem dados)')
    }

    // ─── Compras por Artigo ───────────────────────────────────────────────
    await log('📉 Compras por Artigo (CSV)...')
    // Limpa coleção antes de reimportar
    let totalRemovidosCompra = 0
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const snap = await db().collection('movimentos_compra').limit(400).get().catch(() => null)
      if (!snap || snap.empty) break
      const delBatch = db().batch()
      snap.docs.forEach(d => delBatch.delete(d.ref))
      await delBatch.commit().catch(() => {})
      totalRemovidosCompra += snap.size
    }
    if (totalRemovidosCompra > 0) await log(`  🗑️ ${totalRemovidosCompra} registos de compras antigos removidos`)
    const csvCompras = await exportarCSV(page, '/MReports/Transactions/PurchasesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
      timeout: 60000,
    })
    if (csvCompras) {
      const compras = parsearCSV(csvCompras)
      await log(`  → ${compras.length} linhas compras | headers: ${Object.keys(compras[0] || {}).join(' | ')}`)
      if (compras[0]) await log(`  → Exemplo: ${JSON.stringify(Object.entries(compras[0]).slice(0,8))}`)
      const opsCompras = compras.flatMap(c => {
        const id = `${c['Document'] || ''}_${c['ArticleCode'] || ''}_${c['DocumentDate'] || ''}`.split('/').join('_')
        if (!id || id === '__') return []
        const totalSemIva = parseFloat((c['TotalWithoutTaxes'] || '0').replace(',','.')) || 0
        const totalComIva = parseFloat((c['TotalWithTaxes'] || c['Total'] || '0').replace(',','.')) || totalSemIva
        return [{ col: 'movimentos_compra', id, data: {
          data:              c['DocumentDate'] || '',
          numero_doc:        c['Document'] || '',
          fornecedor_codigo: c['EntityCode'] || '',
          fornecedor_nome:   c['EntityName'] || '',
          artigo_codigo:     c['ArticleCode'] || '',
          artigo_descricao:  c['ArticleDesignation'] || '',
          familia:           c['FamilyDesignation'] || '',
          quantidade:        parseFloat((c['Quantity'] || '0').replace(',','.')) || 0,
          preco_unitario:    parseFloat((c['UnitaryPriceWithoutTaxesAfterDiscounts'] || '0').replace(',','.')) || 0,
          total:             totalComIva,
          total_sem_iva:     totalSemIva,
          vendedor:          c['SalesPersonName'] || '',
          ultima_sync: now,
        }}]
      })
      await commitBatches(opsCompras)
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
    await browser?.close().catch(() => {})
    releaseLock?.()
  }
}
