/** WebKit pinch gestures must be cancelable even in an installed iOS PWA.
 * Leave taps, scrolling, native controls and button touch-action untouched.
 */
export function installViewportGestures(target: Document = document): () => void {
  const preventZoom = (event: Event) => event.preventDefault();
  const options = { passive: false };
  target.addEventListener('gesturestart', preventZoom, options);
  target.addEventListener('gesturechange', preventZoom, options);
  return () => {
    target.removeEventListener('gesturestart', preventZoom);
    target.removeEventListener('gesturechange', preventZoom);
  };
}
