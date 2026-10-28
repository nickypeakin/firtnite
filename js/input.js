// Keyboard/mouse (pointer lock) and touch controls merged into one input state.
// Mouse buttons are exposed as the codes 'Mouse0' (left) and 'Mouse2' (right).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.locked = false;
    this.touch = false;
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.touches = new Map();
    this.onLockChange = null;
    this.onTouchDetected = null;
    this.blocked = false;
    // Without pointer lock (e.g. a sandboxed frame) the raw mouse deltas still steer the camera.
    this.lockFailed = false;
    this.freeLook = false;

    window.addEventListener('keydown', (e) => {
      if (this.blocked) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.blocked || this.touch) return;
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.released.add(code);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.lockFailed && this.freeLook)) {
        // Some browsers report huge spikes when the lock engages.
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked || this.freeLook) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
    });
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('touchstart', () => {
      if (!this.touch) {
        this.touch = true;
        if (this.onTouchDetected) this.onTouchDetected();
      }
    }, { passive: true });
  }

  requestLock() {
    if (this.touch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (e) {
      this.lockFailed = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.down.clear();
    this.joy.x = this.joy.y = 0;
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  virtualPress(code) {
    this.pressed.add(code);
  }

  setVirtual(code, isDown) {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  moveVector() {
    let x = 0, z = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) z += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) z -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.joy.id !== null) {
      x = this.joy.x;
      z = this.joy.y;
    }
    return { x, z };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
  }

  // Touch layer: joystick on the left half, look drag elsewhere, buttons with data-code.
  bindTouch(root, joyBase, joyKnob) {
    this.touchRoot = root;
    const R = 56;
    const start = (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      const btn = e.target.closest('[data-code]');
      if (btn) {
        const code = btn.dataset.code;
        if (btn.dataset.toggle) {
          this.setVirtual(code, !this.down.has(code));
          btn.classList.toggle('on', this.down.has(code));
        } else if (btn.dataset.tap) {
          this.virtualPress(code);
        } else {
          this.setVirtual(code, true);
        }
        btn.classList.add('pressed');
        this.touches.set(e.pointerId, { role: 'button', btn, code, look: !!btn.dataset.look, x: e.clientX, y: e.clientY });
        return;
      }
      if (e.clientX < window.innerWidth * 0.4 && this.joy.id === null) {
        this.joy.id = e.pointerId;
        this.joy.ox = e.clientX;
        this.joy.oy = e.clientY;
        joyBase.style.left = `${e.clientX}px`;
        joyBase.style.top = `${e.clientY}px`;
        joyBase.classList.add('active');
        joyKnob.style.transform = 'translate(-50%, -50%)';
        this.touches.set(e.pointerId, { role: 'joy' });
        return;
      }
      this.touches.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
    };
    const move = (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      e.preventDefault();
      if (t.role === 'joy') {
        let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.joy.x = dx / R;
        this.joy.y = -dy / R;
        joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        // Push the stick to the edge to sprint.
        if (d > R * 1.25) this.down.add('ShiftLeft');
        else this.down.delete('ShiftLeft');
      } else if (t.role === 'look' || t.look) {
        this.lookX += (e.clientX - t.x) * 2.2;
        this.lookY += (e.clientY - t.y) * 2.2;
        t.x = e.clientX;
        t.y = e.clientY;
      }
    };
    const end = (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      this.touches.delete(e.pointerId);
      if (t.role === 'joy') {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        this.down.delete('ShiftLeft');
        joyBase.classList.remove('active');
      } else if (t.role === 'button') {
        t.btn.classList.remove('pressed');
        if (!t.btn.dataset.toggle && !t.btn.dataset.tap) this.setVirtual(t.code, false);
      }
    };
    root.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
}
