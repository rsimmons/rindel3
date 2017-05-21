// context has:
//   setOutputs
//   state (not to be modified)
//   setState
//   transient
//   (don't need setTransient because it isn't managed by runtime)

export const mousePos = {
  inputs: {},
  outputs: {
    x: {tempo: 'step'},
    y: {tempo: 'step'},
  },

  create: (context) => {
    const onMouseMove = (e) => {
      context.setOutputs({
        x: e.clientX || e.pageX,
        y: e.clientY || e.pageY,
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    context.transient = { onMouseMove };

    // Initial output (before any movement) must be 0,0 unfortunately, can't poll mouse position
    context.setOutputs({
      x: 0,
      y: 0,
    });
  },

  update: (context, inputs) => {
    // Nothing to do here
  },

  destroy: (context) => {
    document.removeEventListener('mousemove', context.transient.onMouseMove);
  },
};

// TODO: Should we hide it if input coords are undefined?
export const redSquare = {
  inputs: {
    x: {tempo: 'step'},
    y: {tempo: 'step'},
  },
  outputs: {},

  create: (context) => {
    const squareElem = document.createElement('div');
    squareElem.style.cssText = 'position: absolute; width: 20px; height: 20px; border: 1px solid black; background: red; pointer-events: none;';
    document.body.appendChild(squareElem);

    context.transient = { squareElem };
  },

  update: (context, inputs) => {
    const x = inputs.x.value;
    const y = inputs.y.value;

    if ((x === undefined) || (y === undefined)) {
      return;
    }

    const el = context.transient.squareElem;
    el.style.left = x;
    el.style.top = y;
  },

  destroy: (context) => {
    document.body.removeChild(context.transient.squareElem);
  },
};

export const showString = {
  inputs: {
    v: {tempo: 'step'},
  },
  outputs: {},

  create: (context) => {
    const divElem = document.createElement('div');
    document.body.appendChild(divElem);

    context.transient = { divElem };
  },

  update: (context, inputs) => {
    const v = inputs.v.value;
    context.transient.divElem.textContent = (v === undefined) ? 'undefined' : v.toString();
  },

  destroy: (context) => {
    document.body.removeChild(context.transient.divElem);
  },
};

export const animationTime = {
  inputs: {},
  outputs: {
    time: {tempo: 'step'},
  },

  create: (context) => {
    context.transient = { reqId: undefined };

    const onFrame = (time) => {
      context.setOutputs({
        time,
      });
      context.transient.reqId = window.requestAnimationFrame(onFrame);
    };

    // Set initial output to reasonable value and kick off updates
    onFrame(performance.now());
  },

  destroy: (context) => {
    document.cancelAnimationFrame(context.transient.reqId);
  },
};
