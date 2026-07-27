// toolboxHelper.ts
// Navega o Toolbox do WinMax4 procurando um atalho pelo título (robusto a mudanças de página/índice)

import { Page } from 'playwright'

export async function clicarToolboxPorTitulo(
  page: Page,
  titulo: string,
  maxPaginas = 11,
  log?: (msg: string) => Promise<void> | void
): Promise<boolean> {
  // CORRIGIDO 27/07/2026: confirmado em produção que todas as páginas do Toolbox
  // apareciam "vazias" na pesquisa — não porque o atalho não existisse, mas porque
  // o Toolbox ainda não tinha acabado de desenhar os ícones quando a pesquisa
  // começou (o CPU deste serviço é muito limitado — 0.15 vCPU — o que torna a
  // renderização lenta). O winmaxRPA.ts já tinha exatamente esta espera antes de
  // usar o Toolbox (para a emissão de faturas), mas nunca tinha sido replicada
  // aqui, usada pelos syncs de Arquivo Digital e SAF-T.
  await page.waitForFunction(
    () => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const doc = tb?.contentDocument
      return !!(doc && doc.readyState === 'complete' &&
        doc.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]').length > 0)
    },
    { timeout: 60000, polling: 500 }
  ).catch(() => {})

  // Garante que começa na página 1 do Toolbox.
  // CORRIGIDO 27/07/2026: este bloco disparava vários cliques em "página anterior"
  // TODOS dentro do mesmo page.evaluate(), sem esperar nada entre eles. Como cada
  // clique dispara um postback ASP.NET (não instantâneo), cliques em sequência tão
  // rápida provavelmente só têm um efeito real — deixando o Toolbox numa página
  // imprevisível, não necessariamente a página 1. Isso fazia a pesquisa seguinte
  // (que já navega corretamente, um clique de cada vez) começar de uma base
  // errada, podendo nunca alcançar a página onde está o atalho procurado.
  // Agora clica uma vez de cada vez, esperando e reavaliando entre cada clique —
  // igual ao padrão já usado (e comprovado) no loop de pesquisa abaixo.
  for (let tentativasReset = 0; tentativasReset < 15; tentativasReset++) {
    const label = await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 1'
    })
    const atual = parseInt(label.split('/')[0].trim()) || 1
    if (atual <= 1) break
    await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      ;(tb?.contentDocument?.getElementById('LinkButtonPrevPage') as HTMLElement)?.click()
    })
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(400)

  for (let p = 1; p <= maxPaginas; p++) {
    // Navega até à página p
    let tentativas = 0
    while (tentativas < 15) {
      const label = await page.evaluate(() => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 1'
      })
      const actual = parseInt(label.split('/')[0].trim())
      if (actual === p) break
      await page.evaluate((vai: string) => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        ;(tb?.contentDocument?.getElementById(vai) as HTMLElement)?.click()
      }, actual < p ? 'LinkButtonNextPage' : 'LinkButtonPrevPage')
      await page.waitForTimeout(600)
      tentativas++
    }

    // Procura o atalho pelo título nesta página
    const resultado = await page.evaluate((t: string) => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const divs = Array.from(tb?.contentDocument?.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]') || [])
      const titulos = divs.map(d => d.getAttribute('title') || '').filter(Boolean)
      const el = divs.find(d => d.getAttribute('title')?.toLowerCase().includes(t.toLowerCase())) as HTMLElement | undefined
      if (el) { el.click(); return { found: el.getAttribute('title'), titulos } }
      return { found: null, titulos }
    }, titulo)

    if (resultado.found) return true
    // CORRIGIDO 27/07/2026: regista os atalhos realmente vistos em cada página —
    // se voltar a falhar, ficamos a saber exatamente o que o Toolbox continha,
    // em vez de só "não encontrado" sem mais contexto.
    await log?.(`  🔍 Toolbox pág. ${p}/${maxPaginas}: [${resultado.titulos.join(', ') || 'vazia'}]`)
  }
  return false
}
