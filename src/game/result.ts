/** Clear-screen over `#ui-root`. Play only reports that the level is clear. */
export function mountResult(actions: { replay: () => void; next: () => void }): { show: () => void } {
  const root = document.getElementById('result');
  const hide = (): void => {
    root?.setAttribute('hidden', '');
  };
  document.getElementById('result-replay')?.addEventListener('click', () => {
    hide();
    actions.replay();
  });
  document.getElementById('result-next')?.addEventListener('click', () => {
    hide();
    actions.next();
  });
  return {
    show: () => {
      root?.removeAttribute('hidden');
    },
  };
}
