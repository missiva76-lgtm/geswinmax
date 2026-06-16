// sync/syncArtigos.ts — Sync incremental de artigos, vendas e compras do WinMax4
import { chromium } from 'playwright'
import * as admin from 'firebase-admin'
import { db, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

interface ArtigoWinmax {
  codigo: string
  descricao: string
  taxa_iva: number
  preco_venda: number
  existencias: number
}

interface MovimentoWinmax {
  data: string
  numero_doc: string
  tipo_doc: string
  cliente_codigo: string
  cliente_nome: string
  artigo_codigo: string
  artigo_descricao: string
  quantidade: number
  preco_unitario: number
  total: number
}

// Nomes das listagens WinMax4 (descobertos via Toolbox shortcuts)
const LISTAGENS = {
  artigos_existencias:  'reportFileArticlesExistences',
  vendas_movimentos:    'reportTransactionsSalesArticleMovements',
  compras_movimentos:   'reportTransactionsPurchasesArticleMovements',
}

async function exportarListagem(
  page: any,
  nomeListagem: string,
  dataInicio: string,
  dataFim: string
): Promise<string> {
  // Abre a listagem via OpenWindow
  await page.evaluate((nome: string) => {
    top.OpenWindow(nome, 'Listagem', '')
  }, nomeListagem)
  await page.waitForTimeout(2000)

  // Aguarda o iframe da listagem
  const iframeId = `${nomeListagem}_content`
  await page.waitForFunction(
    (id: string) => !!document.getElementById(id),
    iframeId,
    { timeout: 10000 }
  )
  await page.waitForTimeout(1500)

  // Preenche datas de início e fim
  await page.evaluate(({ id, di, df }: { id: string; di: string; df: string }) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return

    // Campos de data comuns nas listagens WinMax4
    const camposInicio = ['wucCalendarBeginDate_txtModernDate', 'txtBeginDate', 'txtDataInicio']
    const camposFim    = ['wucCalendarEndDate_txtModernDate',   'txtEndDate',   'txtDataFim']

    for (const sel of camposInicio) {
      const el = doc.getElementById(sel) as HTMLInputElement
      if (el) { el.value = di; el.dispatchEvent(new Event('change', { bubbles: true })); break }
    }
    for (const sel of camposFim) {
      const el = doc.getElementById(sel) as HTMLInputElement
      if (el) { el.value = df; el.dispatchEvent(new Event('change', { bubbles: true })); break }
    }
  }, { id: iframeId, di: dataInicio, df: dataFim })

  await page.waitForTimeout(500)

  // Clica em "Ver" / "Atualizar" / "Pesquisar"
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const btns = [...doc.querySelectorAll('a.OrangeButton, a.GreenButton')]
    const btn = btns.find((b: Element) =>
      ['Ver', 'Atualizar', 'Pesquisar', 'Visualizar'].includes((b as HTMLElement).innerText?.trim())
    ) as HTMLElement
    btn?.click()
  }, iframeId)

  await page.waitForTimeout(3000)

  // Extrai os dados da grelha de resultados
  const dados = await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return '[]'

    // Tenta exportar para JSON via tabela HTML
    const tabela = doc.querySelector('table.grid, table.GridStyle, #gridResults, table[id*="grid"]')
    if (!tabela) return '[]'

    const headers = [...tabela.querySelectorAll('th, thead td')]
      .map((th: Element) => (th as HTMLElement).innerText.trim())

    const linhas = [...tabela.querySelectorAll('tbody tr')]
      .map((tr: Element) => {
        const cells = [...tr.querySelectorAll('td')]
          .map((td: Element) => (td as HTMLElement).innerText.trim())
        return Object.fromEntries(headers.map((h: string, i: number) => [h, cells[i] || '']))
      })
      .filter((l: Record<string, string>) => Object.values(l).some((v: string) => v))

    return JSON.stringify(linhas)
  }, iframeId)

  // Fecha a listagem
  await page.evaluate((id: string) => {
    const baseId = id.replace('_content', '')
    ;(window as any).CloseWindow?.(baseId)
  }, iframeId)

  return dados
}

export async function syncWinmax(): Promise<void> {
  const config = await getConfig()
  const dataInicio = config.sync_data_inicio || '01-01-2000'
  const dataFim    = config.sync_data_fim
    || new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')

  logger.info(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Europe/Lisbon' })
  const page    = await context.newPage()

  try {
    // Login
    const url = `https://app102.winmax4.com/Default.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.fill('#txtUserCode', config.utilizador || '')
    await page.fill('#txtPassword', config.password || '')
    await page.click('#btnLogin')
    await page.waitForLoadState('networkidle')
    logger.info('✅ Login sync OK')

    const batch = db().batch()
    const now   = admin.firestore.FieldValue.serverTimestamp()

    // ─── Artigos + Existências ──────────────────────────────────────────────
    const dadosArtigos = await exportarListagem(
      page, LISTAGENS.artigos_existencias, dataInicio, dataFim
    )
    const artigos: Record<string, string>[] = JSON.parse(dadosArtigos)
    logger.info(`  📦 ${artigos.length} artigos`)

    for (const artigo of artigos) {
      const codigo = artigo['Código'] || artigo['Artigo'] || artigo['Ref.']
      if (!codigo) continue
      const ref = db().collection('artigos').doc(codigo.replace(/\//g, '_'))
      batch.set(ref, {
        codigo,
        descricao:    artigo['Descrição'] || artigo['Designação'] || '',
        taxa_iva:     parseFloat((artigo['IVA'] || artigo['Taxa IVA'] || '23').replace('%', '')) || 23,
        preco_venda:  parseFloat((artigo['Preço'] || artigo['PVP1'] || '0').replace(',', '.')) || 0,
        existencias:  parseFloat((artigo['Existências'] || artigo['Stock'] || '0').replace(',', '.')) || 0,
        ultima_sync:  now,
      }, { merge: true })
    }

    // ─── Movimentos de Venda ────────────────────────────────────────────────
    const dadosVendas = await exportarListagem(
      page, LISTAGENS.vendas_movimentos, dataInicio, dataFim
    )
    const vendas: Record<string, string>[] = JSON.parse(dadosVendas)
    logger.info(`  📈 ${vendas.length} movimentos de venda`)

    for (const v of vendas) {
      const id = `${v['Nº Doc'] || ''}_${v['Artigo'] || ''}_${v['Data'] || ''}`.replace(/\//g, '_')
      if (!id || id === '__') continue
      const ref = db().collection('movimentos_venda').doc(id)
      batch.set(ref, {
        data:              v['Data'] || '',
        numero_doc:        v['Nº Doc'] || '',
        tipo_doc:          v['Tipo'] || '',
        cliente_codigo:    v['Cód. Cliente'] || v['Cliente'] || '',
        cliente_nome:      v['Nome'] || '',
        artigo_codigo:     v['Artigo'] || v['Código'] || '',
        artigo_descricao:  v['Descrição'] || '',
        quantidade:        parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',', '.')) || 0,
        preco_unitario:    parseFloat((v['Preço'] || v['PVP'] || '0').replace(',', '.')) || 0,
        total:             parseFloat((v['Total'] || '0').replace(',', '.')) || 0,
        ultima_sync:       now,
      }, { merge: true })
    }

    // ─── Movimentos de Compra ───────────────────────────────────────────────
    const dadosCompras = await exportarListagem(
      page, LISTAGENS.compras_movimentos, dataInicio, dataFim
    )
    const compras: Record<string, string>[] = JSON.parse(dadosCompras)
    logger.info(`  📉 ${compras.length} movimentos de compra`)

    for (const c of compras) {
      const id = `${c['Nº Doc'] || ''}_${c['Artigo'] || ''}_${c['Data'] || ''}`.replace(/\//g, '_')
      if (!id || id === '__') continue
      const ref = db().collection('movimentos_compra').doc(id)
      batch.set(ref, {
        data:              c['Data'] || '',
        numero_doc:        c['Nº Doc'] || '',
        tipo_doc:          c['Tipo'] || '',
        fornecedor_codigo: c['Cód. Fornecedor'] || c['Fornecedor'] || '',
        fornecedor_nome:   c['Nome'] || '',
        artigo_codigo:     c['Artigo'] || c['Código'] || '',
        artigo_descricao:  c['Descrição'] || '',
        quantidade:        parseFloat((c['Qtd'] || '0').replace(',', '.')) || 0,
        preco_unitario:    parseFloat((c['Preço'] || '0').replace(',', '.')) || 0,
        total:             parseFloat((c['Total'] || '0').replace(',', '.')) || 0,
        ultima_sync:       now,
      }, { merge: true })
    }

    // Commit em batch
    await batch.commit()

    // Regista a sync
    await db().collection('sync_log').add({
      tipo:       'winmax_completa',
      data_inicio: dataInicio,
      data_fim:    dataFim,
      artigos:    artigos.length,
      vendas:     vendas.length,
      compras:    compras.length,
      executado_em: now,
      estado:     'ok',
    })

    logger.info('✅ Sync concluída')
  } catch (err) {
    logger.error(`❌ Sync falhou: ${err}`)
    await db().collection('sync_log').add({
      tipo:  'winmax_completa',
      erro:  String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(),
      estado: 'erro',
    })
  } finally {
    await browser.close()
  }
}
