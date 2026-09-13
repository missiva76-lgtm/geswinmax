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

async function abrirArquivoDigital(page: Page, log?: (msg: string) => Promise<void> | void): Promise<void> {
  // Procura "Arquivo digital" pelo título — robusto a mudanças de página/índice
  const found = await clicarToolboxPorTitulo(page, 'Arquivo digital', 11, log)
  if (!found) {
    // CORRIGIDO 28/07/2026: já tentámos duas vezes diagnosticar isto só por texto
    // de log (todas as páginas reportam "vazia" mesmo depois de esperar o Toolbox
    // carregar) — chegou a um ponto em que precisamos de VER o ecrã real nesse
    // momento, em vez de continuar a especular sobre seletores. Captura-se aqui
    // uma screenshot completa e disponibiliza-se via URL, reaproveitando a mesma
    // pasta estática que já serve os PDFs.
    try {
      const pastaDebug = path.join(process.cwd(), 'pdfs', 'debug')
      fs.mkdirSync(pastaDebug, { recursive: true })
      const nomeFicheiro = `toolbox-vazio-${Date.now()}.png`
      await page.screenshot({ path: path.join(pastaDebug, nomeFicheiro), fullPage: true })
      const backendUrl = process.env.BACKEND_URL || 'https://geswinmax-backend.onrender.com'
      await log?.(`  📸 Screenshot de diagnóstico: ${backendUrl}/api/pdfs/debug/${nomeFicheiro}`)
    } catch (e) {
      await log?.(`  ⚠️ Falha ao capturar screenshot de diagnóstico: ${e}`)
    }
    throw new Error('Atalho "Arquivo digital" não encontrado no Toolbox')
  }
  await page.waitForTimeout(2000)
  await page.waitForFunction(
    () => !!document.getElementById('utilsDigitalArchive_content'), undefined,
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
    () => !!document.getElementById('DigitalArchiveDetails_content'), undefined,
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
  let releaseLock: (() => void) | null = null
  let paginaAtiva: Page | null = null

  try {
    releaseLock = await acquireBrowserLock()
    // CORRIGIDO 27/07/2026: "Target page, context or browser has been closed" —
    // sintoma clássico de o Chromium ficar sem espaço em /dev/shm, que em containers
    // (Render, Docker) costuma vir limitado a 64MB por omissão, independentemente da
    // RAM total da máquina. --disable-dev-shm-usage força o Chromium a usar /tmp em
    // vez de /dev/shm, eliminando esta classe de crash.
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
      ],
    })
    const context = await browser.newContext({
      locale: 'pt-PT',
      timezoneId: 'Europe/Lisbon',
      acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()
    paginaAtiva = page

    // CORRIGIDO 20/07/2026: mesma proteção aplicada ao winmaxRPA.ts — um diálogo
    // nativo do browser (alert/confirm), sem handler registado, bloqueia a página
    // inteira até ao timeout. Aplicado aqui por precaução, já que este sync navega
    // a mesma interface WinMax4.
    page.on('dialog', async (dialog) => {
      await log(`  🔔 Diálogo nativo do browser detetado: [${dialog.type()}] "${dialog.message()}" — a aceitar automaticamente`)
      await dialog.accept().catch(() => {})
    })

    // Login
// Login WinMax4
    // O WinMax4 abre sempre no MainPage com um iframe de autenticação UserAuthentication_content
    // Campos: txtUserLogin / txtUserPassword — botão: wucButtonConfirm_linkButton1
    const url = `https://app102.winmax4.com/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)

    // Aguarda o iframe de autenticação
    await page.waitForFunction(
      () => !!document.getElementById('UserAuthentication_content'), undefined,
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

    await abrirArquivoDigital(page, log)
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

    // CÓDIGO DO CLIENTE (03/09/2026)
    //
    // A listagem do Arquivo Digital do WinMax4 só mostra o NOME do cliente, não o
    // código — por isso `cliente_codigo` era gravado vazio. Mas o nome do ficheiro
    // identifica o documento (ex: 20260831_FRB_2026_239 -> FRB, 2026/239), e a
    // coleção `documentos_emitidos` tem exatamente esses documentos indexados por
    // `TIPO_NUMERO`, com o código do cliente.
    //
    // Carrega-se o mapa UMA vez e cruza-se durante a importação. Como esta sync
    // reimporta tudo, o cruzamento é refeito de cada vez — um documento que hoje
    // não tenha correspondência (por exemplo, emitido depois da última importação
    // de documentos) passa a tê-la na sincronização seguinte, sem intervenção.
    const codigosPorDocumento = new Map<string, string>()
    try {
      const snapDocs = await db().collection('documentos_emitidos')
        .select('tipo_documento', 'numero_documento', 'cliente_codigo')
        .get()
      for (const d of snapDocs.docs) {
        const v = d.data()
        const codigo = (v.cliente_codigo || '').trim()
        // CORRIGIDO 13/09/2026: o WinMax4 atribui o código "0" às faturas
        // simplificadas (consumidor final). Tecnicamente é um código, mas não
        // identifica ninguém — e daria nomes de ficheiro como
        // "0_20260910_FS_2026_46.pdf", que não fazem sentido. Trata-se como ausência.
        if (!codigo || codigo === '0') continue
        const chave = `${(v.tipo_documento || '').trim()}_${(v.numero_documento || '').trim()}`
          .replace(/\//g, '_').toUpperCase()
        codigosPorDocumento.set(chave, codigo)
      }
      await log(`🔗 ${codigosPorDocumento.size} documento(s) com código de cliente disponível para cruzamento`)
    } catch (e) {
      // Não é crítico: sem o mapa, os registos ficam sem código, como antes.
      await log(`⚠️ Não foi possível carregar os códigos de cliente: ${e}`)
    }

    /** Procura o código do cliente pelo tipo e número do documento. */
    const codigoCliente = (tipo?: string, numero?: string): string => {
      if (!tipo || !numero) return ''
      const chave = `${tipo.trim()}_${numero.trim()}`.replace(/\//g, '_').toUpperCase()
      return codigosPorDocumento.get(chave) || ''
    }

    /**
     * Preenche o código de cliente nos documentos JÁ importados.
     *
     * CORRIGIDO 13/09/2026 — ERRO DE ANÁLISE MEU:
     * Ao acrescentar o cruzamento (03/09) afirmei que "como esta sync reimporta
     * tudo, o cruzamento é refeito de cada vez". ERRADO — esta sincronização é
     * INCREMENTAL: salta os ficheiros já importados. Confirmado no log de 13/09,
     * em que as 232 páginas deram "0 novos" e nenhum dos 2315 documentos existentes
     * foi tocado. O campo continuava vazio, como o Carlos reportou.
     *
     * Este passo corrige isso sem obrigar a reimportar as 232 páginas (que demora
     * ~7 minutos de navegação): lê os documentos sem código, cruza com o mapa, e
     * grava só os que passam a ter correspondência. É rápido porque não envolve
     * navegação no WinMax4 — é só Firestore.
     *
     * Corre em todas as sincronizações: um documento que hoje não tenha
     * correspondência (por a importação de Documentos emitidos ainda não o ter
     * apanhado) passa a tê-la assim que essa importação corra.
     */
    const preencherCodigosEmFalta = async (): Promise<void> => {
      if (codigosPorDocumento.size === 0) return
      try {
        const snap = await db().collection('arquivo')
          .select('tipo_documento', 'numero_documento', 'cliente_codigo')
          .get()

        let batch = db().batch()
        let porGravar = 0
        let atualizados = 0

        for (const d of snap.docs) {
          const v = d.data()
          if ((v.cliente_codigo || '').trim()) continue // já tem
          const codigo = codigoCliente(v.tipo_documento, v.numero_documento)
          if (!codigo) continue

          batch.update(d.ref, { cliente_codigo: codigo })
          porGravar++
          atualizados++

          if (porGravar >= 400) {
            await batch.commit()
            batch = db().batch()
            porGravar = 0
          }
        }
        if (porGravar > 0) await batch.commit()

        await log(atualizados > 0
          ? `🔗 ${atualizados} documento(s) existentes passaram a ter código de cliente`
          : '🔗 Nenhum documento existente em falta de código')
      } catch (e) {
        await log(`⚠️ Não foi possível preencher códigos em falta: ${e}`)
      }
    }

    await preencherCodigosEmFalta()

    /**
     * Descarrega o PDF de um documento e guarda-o no Firebase Storage.
     * Devolve o URL do nosso backend, ou `null` se não for possível.
     *
     * Usa a abordagem comprovada em julho (ver winmaxRPA.ts): aproveitar os cookies
     * da sessão já autenticada e ir buscar o ficheiro por HTTP direto, em vez de
     * depender de cliques e do evento de download do browser.
     *
     * Uma falha aqui NÃO interrompe a sincronização — o documento é na mesma
     * importado, apenas sem PDF guardado, e continua acessível pelo caminho lento.
     */
    const guardarPdfNoStorage = async (ficheiro: string): Promise<string | null> => {
      try {
        // ATENÇÃO — NÃO usar um URL direto aqui.
        // Em julho de 2026 tentou-se `DigitalArchiveFileHandler.aspx?file=...` e
        // confirmou-se que devolve ZERO BYTES: esse endereço foi uma suposição e
        // nunca existiu. O WinMax4 não oferece acesso direto aos ficheiros do
        // Arquivo — é preciso clicar no link da linha e intercetar o download.
        // (Registado em memória do projeto; não repetir a tentativa.)
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 })

        const clicou = await page.evaluate((nome: string) => {
          const f = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
          const grid = f?.contentDocument?.getElementById('wucFileList1_fileList') as HTMLTableElement
          if (!grid) return false
          for (const tr of Array.from(grid.querySelectorAll('tbody tr'))) {
            if (!((tr as HTMLElement).innerText || '').includes(nome)) continue
            const link = tr.querySelector('a[id*="lnkSelect"], a') as HTMLElement | null
            if (link) { link.click(); return true }
          }
          return false
        }, ficheiro)

        if (!clicou) return null

        const download = await downloadPromise
        const stream = await download.createReadStream()
        if (!stream) return null

        const partes: Buffer[] = []
        for await (const p of stream) partes.push(Buffer.from(p))
        const buffer = Buffer.concat(partes)

        // Só aceita PDF verdadeiro — se vier outra coisa, algo correu mal.
        if (buffer.length < 100 || buffer.subarray(0, 4).toString() !== '%PDF') return null

        const { uploadPDFToStorage } = await import('../services/firebase')
        await uploadPDFToStorage(buffer, ficheiro, 'arquivo')
        // Servido pelo nosso backend — o Storage não autoriza pedidos vindos do
        // domínio da aplicação (ver a correção do CORS em routes/faturas.ts).
        return `/api/faturas/pdf/arquivo/${encodeURIComponent(ficheiro)}`
      } catch {
        return null
      }
    }

    let totalImportados = 0
    let pagina = 1
    let comCodigo = 0
    let comPdfGuardado = 0

    // CORRIGIDO 03/07/2026: cada documento novo era gravado INDIVIDUALMENTE no Firestore,
    // um `.set()` por documento, sequencialmente. Para o Arquivo Digital, que tipicamente
    // acumula centenas ou milhares de documentos históricos, isto significava uma viagem
    // de rede completa por documento — de longe o maior responsável pela lentidão da
    // sincronização. Agora acumula-se num batch e só se grava de facto quando o batch
    // atinge um tamanho razoável (450, com margem do limite real do Firestore de 500),
    // ou no final da sincronização — reduzindo centenas/milhares de escritas a um punhado
    // de batches.
    const TAMANHO_BATCH = 450
    let batchAtual = db().batch()
    let contadorBatch = 0

    const adicionarAoBatch = (docId: string, data: Record<string, unknown>) => {
      batchAtual.set(db().collection('arquivo').doc(docId), data, { merge: true })
      contadorBatch++
    }

    const flushBatch = async () => {
      if (contadorBatch === 0) return
      try {
        await batchAtual.commit()
        await log(`  💾 Batch gravado (${contadorBatch} docs)`)
      } catch (e) {
        await log(`  ⚠️ Falha ao gravar batch (${contadorBatch} docs): ${e}`)
      }
      batchAtual = db().batch()
      contadorBatch = 0
    }

    while (true) {
      const linhas = await extrairLinhas(page)
      const novas  = linhas.filter(l => l.ficheiro && !existentes.has(l.ficheiro))
      await log(`  Pág. ${pagina}/${total}: ${linhas.length} docs (${novas.length} novos)`)

      for (const linha of novas) {
        const { tipo, numero, ano } = parseFicheiro(linha.ficheiro)
        linha.tipo_documento   = tipo
        linha.numero_documento = numero
        linha.ano              = ano

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

        // Cruza com os Documentos emitidos para obter o código do cliente
        // (ver nota junto a `codigosPorDocumento`).
        const codigo = codigoCliente(linha.tipo_documento, linha.numero_documento)
        if (codigo) comCodigo++

        // Guarda o PDF no Firebase Storage, aproveitando que estamos NESTA página
        // do Arquivo com a sessão já autenticada.
        //
        // ACRESCENTADO 13/09/2026: até aqui só se guardavam os metadados, e cada
        // clique em "Descarregar" abria um browser, autenticava-se, navegava até ao
        // Arquivo, filtrava pela data e percorria as páginas até encontrar o
        // ficheiro — perto de 10 minutos por documento, medido em produção.
        //
        // Guardando aqui, o download passa a ser imediato. Só se aplica a
        // documentos NOVOS: o histórico já importado continua a usar o caminho
        // lento, por decisão do Carlos (importar 2315 PDFs levaria horas e o que
        // interessa na prática são os recentes).
        const pdfUrl = await guardarPdfNoStorage(linha.ficheiro)
        if (pdfUrl) comPdfGuardado++

        adicionarAoBatch(docId, {
          ...linha,
          cliente_codigo: codigo,
          pdf_url:      pdfUrl,
          data_ts:      dataTs,
          importado_em: admin.firestore.FieldValue.serverTimestamp(),
          fonte:        'arquivo_digital_winmax',
        })

        existentes.add(linha.ficheiro)
        totalImportados++

        if (contadorBatch >= TAMANHO_BATCH) await flushBatch()
      }

      const temProxima = await irProximaPagina(page)
      if (!temProxima || pagina >= total) break
      pagina++
    }

    // Grava o que sobrar no último batch (pode não ter atingido TAMANHO_BATCH)
    await flushBatch()

    await db().collection('sync_log').add({
      tipo:             'arquivo_digital',
      data_inicio:      dataInicio,
      data_fim:         dataFim,
      total_importados: totalImportados,
      executado_em:     admin.firestore.FieldValue.serverTimestamp(),
      estado:           'ok',
    })

    await log(`✅ Arquivo Digital: ${totalImportados} documentos importados · ${comCodigo} com código de cliente · ${comPdfGuardado} com PDF guardado (download imediato)`)

  } catch (err) {
    // CORRIGIDO 27/07/2026: o erro só era registado no log do servidor (invisível
    // para o utilizador) e na coleção sync_log — nunca no log do próprio job, que é
    // o que a interface mostra. Isto fazia o processo parecer "preso" sem explicação
    // quando falhava (confirmado em produção: log parava logo a seguir a "Login OK",
    // sem nenhuma indicação do que correu mal).
    await log(`❌ Erro: ${err}`)
    logger.error(`❌ Sync Arquivo Digital: ${err}`)
    await db().collection('sync_log').add({
      tipo:  'arquivo_digital', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    throw err
  } finally {
    // CORRIGIDO 30/07/2026: fechar o browser NÃO termina a sessão do lado do WinMax4,
    // que continua a ocupar um posto de licença. Com sessões abandonadas a acumular,
    // os logins seguintes ficam presos no ecrã de autenticação (confirmado em
    // produção no sync de artigos). Terminar sessão liberta o posto.
    if (paginaAtiva) {
      try {
        const ok = await clicarToolboxPorTitulo(paginaAtiva, 'Terminar sessão')
        if (ok) await paginaAtiva.waitForTimeout(2000)
      } catch { /* não crítico */ }
    }
    await browser?.close().catch(() => {})
    releaseLock?.()
  }
}
