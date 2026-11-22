// Runs the way into a live app (Gate.astro). It only collects: the app says who may come in
// (`enter`, which returns why not, or null) and draws your Mii on the gate's face, as it draws it
// everywhere else. The agreement is noted here, once the app lets you in.
import { agree, agreed, cleanNick, store, STORE } from './store';

export interface Gate {
  /** Shows the gate over the app, with `error` under the name if given. */
  open(error?: string): void;
  close(): void;
  readonly input: HTMLInputElement;
}

export function mountGate(
  el: HTMLElement,
  opts: {
    /** Lets you in under `nick` (already cleaned), or says why not. */
    enter(nick: string): string | null;
    /** The Mii was pressed: the app gives you a new one. */
    shuffle(): void;
    /** What sits behind the gate, kept out of reach while it is up. */
    behind: HTMLElement[];
  },
): Gate {
  const form = el.querySelector('form') ?? el;
  const input = el.querySelector<HTMLInputElement>('[data-gate-name]')!;
  const box = el.querySelector<HTMLInputElement>('[data-gate-agree]')!;
  const go = el.querySelector<HTMLButtonElement>('[data-gate-go]')!;
  const error = el.querySelector<HTMLElement>('[data-gate-error]')!;

  input.value = store.get(STORE.nick) ?? '';
  box.checked = agreed();

  const ready = () => {
    go.disabled = !cleanNick(input.value) || !box.checked;
  };
  const say = (text = '') => {
    error.textContent = text;
    error.hidden = !text;
    input.setAttribute('aria-invalid', String(!!text));
  };
  ready();

  input.addEventListener('input', () => {
    say();
    ready();
  });
  box.addEventListener('change', ready);
  el.querySelector('[data-gate-mii]')?.addEventListener('click', () => opts.shuffle());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (go.disabled) return;
    const why = opts.enter(cleanNick(input.value));
    if (why) {
      say(why);
      input.focus();
      return;
    }
    agree();
  });

  const gate: Gate = {
    input,
    open(text) {
      say(text);
      box.checked = agreed();
      ready();
      el.hidden = false;
      for (const b of opts.behind) b.inert = true;
      // Not on a phone, where the keyboard would cover the agreement before it is read.
      if (matchMedia('(pointer: fine)').matches) input.focus();
    },
    close() {
      el.hidden = true;
      for (const b of opts.behind) b.inert = false;
    },
  };
  return gate;
}
