import { useCallback, useEffect, useRef, useState, type IframeHTMLAttributes } from 'react'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { servePageData, type PageDataCard } from '../lib/page-data'
import { reportThemeCSS } from '../../desktop/service/report-theme.mjs'

// `card` is the card tab this frame shows; only such a frame can save the page's data files.
type Props = Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'onLoad'> & { url: string; onLoad?: () => void; card?: PageDataCard }

// Desktop reports run on their folder's own port, never on the UI's origin, so a same-origin
// report can frame and read its own pages but cannot reach the app or another report. Its only
// way to the app is asking its own frame for its card's data files or a download (mak.data,
// lib/page-data.ts).
export const REPORT_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'

function ThemedFrame({ url, onLoad, card, ...props }: Props) {
  const { resolved } = useWorkspaceTheme()
  const frame = useRef<HTMLIFrameElement>(null)
  // Set the initial colour before a desktop report paints. Later theme changes
  // use a message, preserving scroll position and the report's interactive state.
  const [src] = useState(() => {
    const target = new URL(url, location.href)
    target.searchParams.set('mrmak-theme', resolved)
    // Tells the shared report script (mak.data) that this frame can save the page's data files.
    if (card) target.searchParams.set('mrmak-data', '1')
    return target.href
  })
  // Every frame answers its own page's data requests; only a card tab's frame can serve them.
  const entityId = card?.entityId, step = card?.step, cardPath = card?.path
  useEffect(() => servePageData(frame, entityId === undefined || step === undefined || cardPath === undefined ? null : { entityId, step, path: cardPath }), [entityId, step, cardPath])
  const applyTheme = useCallback(() => {
    const element = frame.current
    if (!element) return
    // Vite serves reports on the same origin. Desktop content is isolated on a
    // second origin, whose prelude accepts theme messages only from its UI.
    // Only touch the document when same-origin: WebKit reports every blocked
    // cross-origin access as an error, even inside try/catch.
    const sameOrigin = new URL(url, location.href).origin === location.origin
    if (sameOrigin) try {
      const doc = element.contentDocument
      if (doc?.documentElement) {
        if (!doc.querySelector('style[data-mrmak-report-theme]')) {
          const style = doc.createElement('style')
          style.dataset.mrmakReportTheme = ''
          style.textContent = reportThemeCSS
          ;(doc.head || doc.documentElement).append(style)
        }
        doc.documentElement.dataset.mrmakTheme = resolved
      }
    } catch { /* Cross-origin reports use the message below. */ }
    // A desktop report runs on its folder's own port, which the UI does not track.
    // The message only carries the theme name.
    element.contentWindow?.postMessage({ type: 'mrmak:theme', theme: resolved }, '*')
  }, [resolved, url])
  useEffect(applyTheme, [applyTheme])
  return <iframe {...props} ref={frame} src={src} onLoad={() => { applyTheme(); onLoad?.() }} />
}

export default function ReportFrame(props: Props) {
  return <ThemedFrame key={props.url} {...props} />
}
