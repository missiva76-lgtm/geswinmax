import { chromium, Browser, Page } from 'playwright'
import * as admin from 'firebase-admin'
import { db, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

const LISTAGENS = {
  artigos_existencias: 'reportFileArticlesExistences',
  vendas_movimentos:   'reportTransactionsSalesArticleMovements',
  compras_movimentos:  'reportTransactionsPurchasesArticleMovements',
}

async function exportarListagem(
  page: Page,
  nomeListagem: string,
  dataInicio: string,
  dataFim: string
): Promise<Record<string, string>[]> {
  const iframeId = `${nomeListagem}_content`

  await page.evaluate((nome: string) => {
    (window as any).OpenWindow?.(nome, 'Listagem', '')
  }, nomeListagem)

  await page.waitForTimeout(2000)

  const existe = await page.evaluate((id: string) => !!document.getElementById(id), iframeId)
  if (!existe) return []

  await page.waitForTimeout(1500)

  // Preenche datas
  await page.evaluate(({ id, di, df }: { id: string; di: string; df: string }) => {
    const f = document.getElementById(id) as HTMLIFrameElement | null
    const doc = f?.contentDocument
    if (!doc) return

    const camposInicio = ['wucCalendarBeginDate_txtModernDate', 'txtBeginDate', 'txtDataInicio']
    const camposFim    = ['wucCalendarEndDate_txtModernDate', 'txtEndDate', 'txtDataFim']

    for (const sel of camposInicio) {
      const el = doc.getElementById(sel) as HTMLInputElement | null
      if (el) { el.value = di; el.dispatchEvent(new Event('change', { bubbles: true })); break }
    }
    for (const sel of camposFim) {
      const el = doc.getElementById(sel) as HTMLInputElement | null
      if (el) { el.value = df; el.dispatchEvent(new Event('change', { bubbles: true })); break }
    }
  }, { id: iframeId, di: dataInicio, df: dataFim })

  await page.waitForTimeout(500)

  // Clica em Ver/Pesquisar
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement | null
    const doc = f?.contentDocument
    if (!doc) return
    const links = Array.from(doc.querySelectorAll('a'))
    const btn = links.find(a => ['Ver','Atualizar','Pesquisar','Visualizar'].includes(a.innerText?.trim())) as HTMLElement | undefined
    btn?.click()
  }, iframeId)

  await page.waitForTimeout(3000)

  // Extrai dados da tabela
  const dados = await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement | null
    const doc = f?.contentDocument
    if (!doc) return '[]'

    const tabela = doc.querySelector('table.grid, table.GridStyle, #gridResults')
    if (!tabela) return '[]'

    const headers = Array.from(tabela.querySelectorAll('th, thead td'))
      .map(th => (th as HTMLElement).innerText.trim())

    const linhas = Array.from(tabela.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'))
        .map(td => (td as HTMLElement).innerText.trim())
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = cells[i] || '' })
      return obj
    }).filter(l => Object.values(l).some(v => v))

    return JSON.stringify(linhas)
  }, iframeId)

  // Fecha a listagem
  await page.evaluate((id: string) => {
    const baseId = id.replace('_content', '')
    ;(window as any).CloseWindow?.(baseId)
  }, iframeId)

  try { return JSON.parse(dados) } catch { return [] }
}

export async function syncWinmax(): Promise<void> {
  const config = await getConfig()
  const dataInicio = config.sync_data_inicio || '01-01-2000'
  const dataFim    = config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')

  logger.info(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Europe/Lisbon' })
    const page    = await context.newPage()

    const url = `https://app102.winmax4.com/Default.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.fill('#txtUserCode', config.utilizador || '')
    await page.fill('#txtPassword', config.password || '')
    await page.click('#btnLogin')
    await page.waitForLoadState('networkidle')
    logger.info('✅ Login sync OK')

    const batch = db().batch()
    const now   = admin.firestore.FieldValue.serverTimestamp()

    // Artigos
    const artigos = await exportarListagem(page, LISTAGENS.artigos_existencias, dataInicio, dataFim)
    logger.info(`  📦 ${artigos.length} artigos`)
    for (const artigo of artigos) {
      const codigo = artigo['Código'] || artigo['Artigo'] || artigo['Ref.']
      if (!codigo) continue
      const ref = db().collection('artigos').doc(codigo.replace(/\//g, '_'))
      batch.set(ref, {
        codigo,
        descricao:   artigo['Descrição'] || artigo['Designação'] || '',
        taxa_iva:    parseFloat((artigo['IVA'] || '23').replace('%','')) || 23,
        preco_venda: parseFloat((artigo['Preço'] || artigo['PVP1'] || '0').replace(',','.')) || 0,
        existencias: parseFloat((artigo['Existências'] || artigo['Stock'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // Vendas
    const vendas = await exportarListagem(page, LISTAGENS.vendas_movimentos, dataInicio, dataFim)
    logger.info(`  📈 ${vendas.length} movimentos de venda`)
    for (const v of vendas) {
      const id = `${v['Nº Doc']||''}_${v['Artigo']||''}_${v['Data']||''}`.replace(/\//g,'_')
      if (!id || id === '__') continue
      batch.set(db().collection('movimentos_venda').doc(id), {
        data: v['Data']||'', numero_doc: v['Nº Doc']||'', tipo_doc: v['Tipo']||'',
        cliente_codigo: v['Cód. Cliente']||v['Cliente']||'', cliente_nome: v['Nome']||'',
        artigo_codigo: v['Artigo']||v['Código']||'', artigo_descricao: v['Descrição']||'',
        quantidade: parseFloat((v['Qtd']||'0').replace(',','.')) || 0,
        preco_unitario: parseFloat((v['Preço']||'0').replace(',','.')) || 0,
        total: parseFloat((v['Total']||'0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // Compras
    const compras = await exportarListagem(page, LISTAGENS.compras_movimentos, dataInicio, dataFim)
    logger.info(`  📉 ${compras.length} movimentos de compra`)
    for (const c of compras) {
      const id = `${c['Nº Doc']||''}_${c['Artigo']||''}_${c['Data']||''}`.replace(/\//g,'_')
      if (!id || id === '__') continue
      batch.set(db().collection('movimentos_compra').doc(id), {
        data: c['Data']||'', numero_doc: c['Nº Doc']||'', tipo_doc: c['Tipo']||'',
        fornecedor_codigo: c['Cód. Fornecedor']||c['Fornecedor']||'', fornecedor_nome: c['Nome']||'',
        artigo_codigo: c['Artigo']||c['Código']||'', artigo_descricao: c['Descrição']||'',
        quantidade: parseFloat((c['Qtd']||'0').replace(',','.')) || 0,
        preco_unitario: parseFloat((c['Preço']||'0').replace(',','.')) || 0,
        total: parseFloat((c['Total']||'0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    await batch.commit()

    await db().collection('sync_log').add({
      tipo: 'winmax_completa', data_inicio: dataInicio, data_fim: dataFim,
      artigos: artigos.length, vendas: vendas.length, compras: compras.length,
      executado_em: now, estado: 'ok',
    })

    logger.info('✅ Sync concluída')
  } catch (err) {
    logger.error(`❌ Sync falhou: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
  } finally {
    await browser?.close()
  }
}
