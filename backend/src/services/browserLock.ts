// Semáforo global — só um processo Playwright de cada vez no Render
let locked = false
const queue: Array<() => void> = []

export async function acquireBrowserLock(): Promise<() => void> {
  if (!locked) {
    locked = true
    return release
  }
  // Aguarda até o lock ser libertado
  return new Promise<() => void>(resolve => {
    queue.push(() => {
      locked = true
      resolve(release)
    })
  })
}

function release() {
  const next = queue.shift()
  if (next) {
    next()
  } else {
    locked = false
  }
}

export function isBrowserLocked(): boolean {
  return locked
}

// Reset forçado do lock (usar quando browser ficou preso por crash)
export function resetBrowserLock(): void {
  locked = false
  queue.length = 0
}
