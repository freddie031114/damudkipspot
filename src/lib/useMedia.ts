import { useEffect, useState } from 'react'

/** Phones and small tablets in portrait. The app has one layout above this width and a separate one at or below it. */
export const MOBILE_QUERY = '(max-width: 767px)'

function read(): boolean {
  try {
    return window.matchMedia(MOBILE_QUERY).matches
  } catch {
    return false
  }
}

/** True on a phone-sized screen; updates if the window is resized or the phone is rotated. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const on = () => setMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}
