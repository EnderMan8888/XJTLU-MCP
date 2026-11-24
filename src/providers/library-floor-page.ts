import { LIBRARY_ORIGIN } from '../shared/library.ts'

// The floor cards navigate on click instead of exposing a link. Read their
// room ID from the component bound to each card, and the counts from its text.
function inspectFloorCards(origin: string): unknown {
  if (location.origin !== origin || location.hash.split('?')[0] !== '#/ic/home') return null
  const count = (element: Element | null): number | null => {
    const text = element?.textContent?.trim()
    return text && /^\d+$/.test(text) ? Number(text) : null
  }
  return {
    code: 0,
    data: Array.from(document.querySelectorAll('.seat-status')).slice(0, 20).map(group => ({
      name: group.querySelector(':scope > .title')?.firstChild?.textContent?.trim(),
      children: Array.from(group.querySelectorAll('.seat-status-item')).slice(0, 200).map(item => {
        const card = item as Element & { __vue__?: { $props?: { region?: { id?: number } } } }
        return {
          id: card.__vue__?.$props?.region?.id,
          name: item.querySelector(':scope > .title')?.textContent?.trim(),
          remainCount: count(item.querySelector('.left .txt')),
          totalCount: count(item.querySelector('.right .txt'))
        }
      })
    }))
  }
}

export const libraryFloorPageScript = `(${inspectFloorCards.toString()})(${JSON.stringify(LIBRARY_ORIGIN)})`
