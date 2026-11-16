// Standalone diagnostic: retain native switch defaults in the original A–E variants.
for (const name of ['a', 'b', 'c', 'd', 'e']) {
  const input = document.getElementById(`test-${name}`);
  const output = document.getElementById(`count-${name}`);
  const button = document.querySelector(`[data-test="${name}"]`);
  let count = 0;
  let timer;
  const record = (event) => {
    output.value = String(++count);
    document.getElementById('event-details').textContent =
      `${name.toUpperCase()}: trusted=${event.isTrusted}, checked=${input.checked}`;
    if (button) {
      button.classList.add('pressed');
      clearTimeout(timer);
      timer = setTimeout(() => button.classList.remove('pressed'), 150);
    }
  };
  input.addEventListener('click', record);
  // Accessible button activation records once without synthesizing a switch tap.
  if (button)
    button.addEventListener('click', (event) => {
      if (event.target === button) record(event);
    });
}

// Keep diagnostics outside the replaceable targets: navigation must not reset them.
function navigationTrial(name, deferred) {
  const host = document.getElementById(`target-${name}`);
  const template = document.getElementById(`template-${name}`);
  let clicks = 0;
  let actions = 0;
  let selected = 'Today';
  function record(event, input) {
    document.getElementById(`count-${name}`).value = String(++clicks);
    document.getElementById('event-details').textContent =
      `${name.toUpperCase()}: trusted=${event.isTrusted}, checked=${input.checked}, action=${deferred ? 'deferred' : 'synchronous'}`;
  }
  function render() {
    host.replaceChildren(template.content.cloneNode(true));
    const buttons = host.querySelectorAll('button');
    for (const [index, button] of buttons.entries()) {
      const input = name === 'h' ? document.createElement('input') : host.querySelector('input');
      if (name === 'h') {
        // Match the app's injected sibling switch, without CSP-blocked style attributes.
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        input.setAttribute('aria-hidden', 'true');
        input.tabIndex = -1;
        input.id = `test-h-${button.dataset.tab.toLowerCase()}`;
        input.className = `haptic-overlay tab-overlay-${index}`;
        button.classList.add('haptic-button');
        button.classList.toggle('active', button.dataset.tab === selected);
        if (button.dataset.tab === selected) button.setAttribute('aria-current', 'page');
        button.after(input);
      }
      button.addEventListener('click', () => {
        document.getElementById(`actions-${name}`).value = String(++actions);
        if (name === 'h') {
          selected = button.dataset.tab;
          document.getElementById('selected-h').value = selected;
        }
        render(); // Removes the switch and button, mimicking a navigation transition.
      });
      input.addEventListener('click', (event) => {
        event.stopPropagation();
        record(event, input);
        if (name === 'h') button.classList.add('haptic-pressed');
        // Never cancel the switch default or synthesize activation on a switch.
        if (deferred) setTimeout(() => button.click(), 0);
        else button.click();
      });
    }
  }
  render();
}
navigationTrial('f', false);
navigationTrial('g', true);
navigationTrial('h', true);
