type NoteMotion = {
  element: HTMLElement;
  width: number;
  height: number;
  homeX: number;
  homeY: number;
  homeAngle: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  spin: number;
  seed: number;
  falling: boolean;
  dropDelay: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Paper falls into the stack on first view, then hovering anywhere in the footer
// scatters it. Both phases share velocity so the handoff stays smooth.
export function initNoteFooter(footer: HTMLElement): void {
  const scene = footer.querySelector<HTMLElement>('[data-note-scene]');
  if (!scene) return;
  const elements = [...scene.querySelectorAll<HTMLElement>('[data-note]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const { signal } = abort;
  let notes: NoteMotion[] = [];
  let width = scene.clientWidth;
  let height = scene.clientHeight;
  let frame: number | undefined;
  let previousTime = 0;
  let visible = false;
  let hasEntered = false;
  let pointer: { x: number; y: number } | undefined;

  const stop = (): void => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    previousTime = 0;
  };

  const step = (time: number): void => {
    frame = undefined;
    if (!visible || document.hidden || reducedMotion.matches) return;
    const dt = previousTime ? Math.min((time - previousTime) / 16.667, 1.5) : 1;
    previousTime = time;
    let energy = 0;
    for (const note of notes) {
      let targetX = note.homeX;
      let targetY = note.homeY;
      let targetAngle = note.homeAngle;
      if (pointer) {
        const dx = note.homeX - pointer.x;
        const dy = note.homeY - pointer.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const phase = time * 0.001 + note.seed * 2.7;
        const proximity = Math.max(0, 1 - distance / 320);
        const spread = 20 + note.seed * 3 + proximity * 28;
        targetX += (dx / distance) * spread + Math.sin(phase) * 12;
        targetY += (dy / distance) * spread * 0.55 + Math.cos(phase * 0.8) * 9;
        targetAngle += Math.sin(phase) * 0.075 + (dx / distance) * 0.035;
      }
      // Reserve space for the rotated corners while the sheets drift.
      const halfWidth =
        (Math.abs(Math.cos(targetAngle)) * note.width +
          Math.abs(Math.sin(targetAngle)) * note.height) /
        2;
      const halfHeight =
        (Math.abs(Math.sin(targetAngle)) * note.width +
          Math.abs(Math.cos(targetAngle)) * note.height) /
        2;
      targetX = clamp(targetX, halfWidth + 4, width - halfWidth - 4);
      targetY = clamp(targetY, halfHeight + 4, height - halfHeight - 4);
      if (note.falling) {
        note.dropDelay -= dt * 16.667;
        if (note.dropDelay > 0) {
          energy += 1;
          continue;
        }
        note.vx = (note.vx + (targetX - note.x) * 0.002 * dt) * 0.98 ** dt;
        note.vy += 0.75 * dt;
        note.spin = (note.spin + (targetAngle - note.angle) * 0.004 * dt) * 0.96 ** dt;
        note.x += note.vx * dt;
        note.y += note.vy * dt;
        note.angle += note.spin * dt;
        if (note.y >= targetY) {
          note.y = targetY;
          note.vy *= -0.2;
          note.falling = false;
        }
      } else {
        note.vx = (note.vx + (targetX - note.x) * 0.018 * dt) * 0.84 ** dt;
        note.vy = (note.vy + (targetY - note.y) * 0.018 * dt) * 0.84 ** dt;
        note.spin = (note.spin + (targetAngle - note.angle) * 0.018 * dt) * 0.84 ** dt;
        note.x += note.vx * dt;
        note.y += note.vy * dt;
        note.angle += note.spin * dt;
      }
      note.element.style.transform =
        'translate3d(' +
        (note.x - note.width / 2) +
        'px, ' +
        (note.y - note.height / 2) +
        'px, 0) rotate(' +
        note.angle +
        'rad)';
      energy +=
        Number(note.falling) +
        Math.abs(note.vx) +
        Math.abs(note.vy) +
        Math.abs(note.spin) * 100 +
        Math.abs(targetX - note.x) +
        Math.abs(targetY - note.y);
    }
    if (pointer || energy > 0.1) frame = window.requestAnimationFrame(step);
  };

  const wake = (): void => {
    if (frame === undefined && visible && !document.hidden && !reducedMotion.matches) {
      frame = window.requestAnimationFrame(step);
    }
  };

  const reset = (): void => {
    stop();
    width = scene.clientWidth;
    height = scene.clientHeight;
    elements.forEach((element) => {
      element.style.removeProperty('left');
      element.style.removeProperty('top');
      element.style.removeProperty('transform');
    });
    const sceneRect = scene.getBoundingClientRect();
    notes = elements
      .filter((element) => element.offsetWidth > 0)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const angle =
          (Number.parseFloat(getComputedStyle(element).getPropertyValue('--note-angle')) *
            Math.PI) /
          180;
        const x = rect.x + rect.width / 2 - sceneRect.x;
        const y = rect.y + rect.height / 2 - sceneRect.y;
        const falling = !hasEntered && !reducedMotion.matches;
        const note: NoteMotion = {
          element,
          width: element.offsetWidth,
          height: element.offsetHeight,
          homeX: x,
          homeY: y,
          homeAngle: angle,
          x: falling ? x + Math.sin(index * 2.7) * 36 : x,
          y: falling ? -element.offsetHeight / 2 - 30 - (index % 3) * 24 : y,
          angle: falling ? angle + Math.cos(index * 1.9) * 0.3 : angle,
          vx: 0,
          vy: 0,
          spin: 0,
          seed: index + 1,
          falling,
          dropDelay: ((index * 7) % elements.length) * 55,
        };
        if (!reducedMotion.matches) {
          element.style.left = '0';
          element.style.top = '0';
          element.style.transform =
            'translate3d(' +
            (note.x - note.width / 2) +
            'px, ' +
            (note.y - note.height / 2) +
            'px, 0) rotate(' +
            note.angle +
            'rad)';
        }
        return note;
      });
    wake();
  };

  const updatePointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
    const rect = scene.getBoundingClientRect();
    pointer = {
      x: clamp(event.clientX - rect.left, 0, width),
      y: clamp(event.clientY - rect.top, 0, height),
    };
    wake();
  };
  footer.addEventListener('pointerenter', updatePointer, { signal, passive: true });
  footer.addEventListener('pointermove', updatePointer, { signal, passive: true });
  footer.addEventListener(
    'pointerleave',
    () => {
      pointer = undefined;
      wake();
    },
    { signal },
  );
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) {
        hasEntered = true;
        wake();
      } else stop();
    },
    { threshold: 0.05 },
  );
  observer.observe(scene);
  const resizeObserver = new ResizeObserver(() => {
    if (scene.clientWidth !== width || scene.clientHeight !== height) reset();
  });
  resizeObserver.observe(scene);
  reducedMotion.addEventListener('change', reset, { signal });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : wake()), {
    signal,
  });
  reset();
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      stop();
      abort.abort();
      observer.disconnect();
      resizeObserver.disconnect();
    },
    { once: true },
  );
}
