// Standalone diagnostic: retain native switch defaults in all five variants.
for (const name of ['a', 'b', 'c', 'd', 'e']) {
  const input = document.getElementById(`test-${name}`);
  const output = document.getElementById(`count-${name}`);
  const button = document.querySelector(`[data-test="${name}"]`);
  let count = 0;
  let timer;
  const record = event => {
    output.value = String(++count);
    document.getElementById('event-details').textContent = `${name.toUpperCase()}: trusted=${event.isTrusted}, checked=${input.checked}`;
    if (button) {
      button.classList.add('pressed');
      clearTimeout(timer);
      timer = setTimeout(() => button.classList.remove('pressed'), 150);
    }
  };
  input.addEventListener('click', record);
  // Accessible button activation records once without synthesizing a switch tap.
  if (button) button.addEventListener('click', event => {
    if (event.target === button) record(event);
  });
}
