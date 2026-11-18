/** Saves generated text as a download, as the app's own Download buttons do (a card page's `mak.data.download`). */
export function downloadText(name: string, text: string) {
  const objectUrl = URL.createObjectURL(new Blob([text], { type: /\.json$/i.test(name) ? 'application/json' : 'text/plain;charset=utf-8' }))
  const link = document.createElement('a'); link.href = objectUrl; link.download = name
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
}
export async function downloadImage(url: string, name?: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed (${response.status}).`)
  const blob = await response.blob(), objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = objectUrl
  link.download = name || decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'image')
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
}
