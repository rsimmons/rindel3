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
      context.transient.reqId = requestAnimationFrame(onFrame);
    };

    // Set initial output to reasonable value and kick off updates
    onFrame(performance.now());
  },

  destroy: (context) => {
    cancelAnimationFrame(context.transient.reqId);
  },
};

export const audioManager = {
  inputs: {
    audioBuffer: {tempo: 'event'},
  },
  outputs: {
    renderAudio: {tempo: 'event'},
    sampleRate: {tempo: 'const'},
  },

  create: (context) => {
    const BUFFER_SIZE = 1024;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const onAudioProcess = (e) => {
      context.transient.bufferToFill = e.outputBuffer.getChannelData(0);
      context.setOutputs({
        renderAudio: BUFFER_SIZE,
      });
      context.transient.bufferToFill = null;
      // NOTE: If buffer didn't get filled (e.g. no input connected), that's fine
    };

    const scriptNode = audioContext.createScriptProcessor(BUFFER_SIZE, 0, 1); // 0 input channels, 1 output channel
    scriptNode.onaudioprocess = onAudioProcess;
    scriptNode.connect(audioContext.destination);

    context.transient = {
      BUFFER_SIZE,
      audioContext,
      scriptNode,
      bufferToFill: null,
    };

    // Set initial output
    context.setOutputs({
      sampleRate: audioContext.sampleRate,
    });
  },

  update: (context, inputs) => {
    // NOTE: We expect to receive an audioBuffer event in the same instant that we emit the renderAudio event.
    // In other words, the emission of the renderAudio event must _synchronously_ cause us to receive an audioBuffer
    // event in response, it's like a function call.
    if (!context.transient.bufferToFill) {
      // This shouldn't happen. We could potentially ignore it, but for now we'll throw
      throw new Error('received input when not rendering');
    }

    // TODO: assert that we've received an audioBuffer event

    if (inputs.audioBuffer.value.length !== context.transient.BUFFER_SIZE) {
      throw new Error('receive audio buffer of wrong size');
    }

    context.transient.bufferToFill.set(inputs.audioBuffer.value);
  },

  destroy: (context) => {
    context.transient.scriptNode.disconnect();
    context.transient.audioContext.close();
  },
};

export const noise = {
  inputs: {
    renderAudio: {tempo: 'event'},
  },
  outputs: {
    audioBuffer: {tempo: 'event'},
  },

  create: (context) => {
  },

  update: (context, inputs) => {
    // TODO: assert that we received renderAudio event?

    const frames = inputs.renderAudio.value;
    const audioBuffer = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      audioBuffer[i] = 0.1*Math.random() - 0.05;
    }

    context.setOutputs({
      audioBuffer,
    });
  },

  destroy: (context) => {
  },
};
