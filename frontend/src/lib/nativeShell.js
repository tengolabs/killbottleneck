// Nativní obal (Capacitor, product/mobile). Bridge je injektovaný před spuštěním
// skriptů stránky, takže je bezpečné se ptát hned při module load.
export const isNativeShell = () =>
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
