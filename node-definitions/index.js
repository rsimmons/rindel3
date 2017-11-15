// context has:
//   setOutputs
//   state (not to be modified)
//   setState
//   transient
//   (don't need setTransient because it isn't managed by runtime)

export const grid = {
  inputs: {},
  outputs: {
    arr: {tempo: 'step'},
  },

  create: (context) => {
    const arr = [];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        arr.push({
          x: 50*x,
          y: 50*y,
        });
      }
    }
    context.setOutputs({
      arr,
    });
  },
};

export const forEach = {
  functionParameters: {
    f: {
      inputs: {
        elem: {tempo: 'step'},
      },
      outputs: {},
    },
  },
  inputs: {
    arr: {tempo: 'step'},
  },
  outputs: {
  },

  create: (context) => {
    context.transient = {
      activations: [],
    };
  },

  update: (context, inputs) => {
    const arr = inputs.arr.value || [];
    const activations = context.transient.activations;
    const f = context.functionArguments.get('f');

    // Trim any excess activations
    if (activations.length > arr.length) {
      for (let i = arr.length; i < activations.length; i++) {
        activations[i].destroy();
      }
      activations.length = arr.length;
    }

    // Push array values to all current activations
    for (let i = 0; i < activations.length; i++) {
      activations[i].update(new Map([['elem', {value: arr[i], changed: true}]]));
    }

    // Create any new activations, pushing initial values
    if (activations.length < arr.length) {
      for (let i = activations.length; i < arr.length; i++) {
        activations.push(f.activate(new Map([['elem', {value: arr[i], changed: true}]]), (outputs) => {
          // TODO: shouldn't be possible? ignore?
        }));
      }
    }
  },

  destroy: (context) => {
    // TODO: clean up activations
  },
};

export const mousePos = {
  inputs: {},
  outputs: {
    p: {tempo: 'step'},
  },

  create: (context) => {
    const onMouseMove = (e) => {
      context.setOutputs({
        p: {x: e.clientX || e.pageX, y: e.clientY || e.pageY},
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    context.transient = { onMouseMove };

    // Initial output (before any movement) must be 0,0 unfortunately, can't poll mouse position
    context.setOutputs({p: {x: 0, y: 0}});
  },

  destroy: (context) => {
    document.removeEventListener('mousemove', context.transient.onMouseMove);
  },
};

export const mouseDown = {
  inputs: {},
  outputs: {
    down: {tempo: 'step'},
  },

  create: (context) => {
    const onMouseDown = (e) => {
      context.setOutputs({
        down: true,
      });
    };

    const onMouseUp = (e) => {
      context.setOutputs({
        down: false,
      });
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    context.transient = {
      onMouseDown,
      onMouseUp,
    };

    // Set initial output (we assume up, but will be fine if already up
    context.setOutputs({
      down: false,
    });
  },

  destroy: (context) => {
    document.removeEventListener('mousedown', context.transient.onMouseDown);
    document.removeEventListener('mouseup', context.transient.onMouseUp);
  },
};

export const mouseClick = {
  inputs: {},
  outputs: {
    click: {tempo: 'event'},
  },

  create: (context) => {
    const onClick = (e) => {
      context.setOutputs({
        click: null,
      });
    };

    document.addEventListener('click', onClick);

    context.transient = {
      onClick
    };
  },

  destroy: (context) => {
    document.removeEventListener('click', context.transient.onClick);
  },
};

// TODO: Should we hide it if input coords are undefined?
export const redSquare = {
  inputs: {
    p: {tempo: 'step'},
  },
  outputs: {},

  create: (context) => {
    const squareElem = document.createElement('div');
    squareElem.style.cssText = 'position: absolute; width: 20px; height: 20px; border: 1px solid black; background: red; pointer-events: none;';
    document.body.appendChild(squareElem);

    context.transient = { squareElem };
  },

  update: (context, inputs) => {
    const p = inputs.p.value;
    if (p === undefined) {
      return;
    }

    const el = context.transient.squareElem;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
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
    divElem.style.cssText = 'position: absolute; top: 0; right: 0; pointer-events: none; background: white; border: 1px solid red; color: black; font-size: 24px; padding: 5px';
    divElem.textContent = '(undefined)';
    document.body.appendChild(divElem);

    context.transient = { divElem };
  },

  update: (context, inputs) => {
    const v = inputs.v.value;
    context.transient.divElem.textContent = (v === undefined) ? '(undefined)' : v.toString();
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

export const eventCount = {
  inputs: {
    events: {tempo: 'event'},
  },
  outputs: {
    count: {tempo: 'step'},
  },

  create: (context) => {
    context.setState({count: 0});
    context.setOutputs({count: 0});
  },

  update: (context, inputs) => {
    if (!inputs.events.present) {
      return;
    }

    const newCount = context.state.count + 1;
    context.setState({count: newCount});
    context.setOutputs({count: newCount});
  },
}

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
      context.transient.bufferFilled = false;
      context.setOutputs({
        renderAudio: BUFFER_SIZE,
      });
      if (!context.transient.bufferFilled) {
        // If buffer didn't get filled, fill with zeroes since old data seems to persist otherwise
        context.transient.bufferToFill.fill(0);
      }
      context.transient.bufferToFill = null;
    };

    const scriptNode = audioContext.createScriptProcessor(BUFFER_SIZE, 0, 1); // 0 input channels, 1 output channel
    scriptNode.onaudioprocess = onAudioProcess;
    scriptNode.connect(audioContext.destination);

    context.transient = {
      BUFFER_SIZE,
      audioContext,
      scriptNode,
      bufferToFill: null,
      bufferFilled: false,
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
      // This means we received a buffer without having emitted a renderAudio event in same instant. Ignore it.
      return;
    }

    if (!inputs.audioBuffer.present) {
      throw new Error('internal error');
    }

    if (inputs.audioBuffer.value.length !== context.transient.BUFFER_SIZE) {
      throw new Error('receive audio buffer of wrong size');
    }

    context.transient.bufferToFill.set(inputs.audioBuffer.value);
    context.transient.bufferFilled = true;
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

  update: (context, inputs) => {
    if (!inputs.renderAudio.present) {
      throw new Error('internal error');
    }

    const frames = inputs.renderAudio.value;
    const audioBuffer = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      audioBuffer[i] = 0.1*Math.random() - 0.05;
    }

    context.setOutputs({
      audioBuffer,
    });
  },
};

export const boolToAudioGate = {
  inputs: {
    renderAudio: {tempo: 'event'},
    on: {tempo: 'step'},
  },
  outputs: {
    audioBuffer: {tempo: 'event'},
  },

  update: (context, inputs) => {
    if (inputs.renderAudio.present) {
      const frames = inputs.renderAudio.value;
      const audioBuffer = new Float32Array(frames);
      audioBuffer.fill(inputs.on.value ? 1 : 0);

      context.setOutputs({
        audioBuffer,
      });
    }
  },
};

export const multiplier = {
  inputs: {
    renderAudio: {tempo: 'event'},
    a: {tempo: 'event'},
    b: {tempo: 'event'},
  },
  outputs: {
    audioBuffer: {tempo: 'event'},
  },

  update: (context, inputs) => {
    if (!inputs.renderAudio.present) {
      // Received input audio without render event. Ignore
      return;
    }

    const frames = inputs.renderAudio.value;
    const audioBuffer = new Float32Array(frames);

    if (!inputs.a.present || !inputs.b.present) {
      audioBuffer.fill(0);
    } else {
      if ((inputs.a.value.length !== frames) || (inputs.b.value.length !== frames)) {
        throw new Error('input audio buffer wrong length');
      }

      for (let i = 0; i < frames; i++) {
        audioBuffer[i] = inputs.a.value[i]*inputs.b.value[i];
      }
    }

    context.setOutputs({
      audioBuffer,
    });
  },
}
