function buildConstant(value) {
  return {
    inputs: [],
    output: {tempo: 'step'},

    activate: (initialInputs, onOutputChange) => {
      onOutputChange(value);
      return {};
    },
  };
}

function buildPointwiseUnary(f) {
  return {
    inputs: [
      {tempo: 'step'},
    ],
    output: {tempo: 'step'},

    activate: (initialInputs, onOutputChange) => {
      onOutputChange(f(initialInputs[0].value));
      return {
        update: (inputs) => {
          onOutputChange(f(inputs[0].value));
        },
      };
    },
  };
}

function buildPointwiseBinary(f, filterUndef) {
  return {
    inputs: [
      {tempo: 'step'},
      {tempo: 'step'},
    ],
    output: {tempo: 'step'},

    activate: (initialInputs, onOutputChange) => {

      const update = (a, b) => {
        const av = a.value;
        const bv = b.value;

        if (filterUndef && ((av === undefined) || (bv === undefined))) {
          onOutputChange(undefined);
        } else {
          onOutputChange(f(av, bv));
        }
      }

      update(...initialInputs);

      return {
        update: (inputs) => {
          update(...inputs);
        },
      };
    },
  };
}

export const one = buildConstant(1);
export const oneToTen = buildConstant([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const double = buildPointwiseUnary(v => 2*v);

export const grid = buildPointwiseUnary(size => {
  size = size || 0;

  const arr = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      arr.push({
        x: 50*x,
        y: 50*y,
      });
    }
  }

  return arr;
});

export const add = buildPointwiseBinary((a, b) => a + b);
export const addVec = buildPointwiseBinary((a, b) => ({x: a.x+b.x, y: a.y+b.y}), true);

export const literal = {
  inputs: [],
  output: {tempo: 'step'},
  defaultSettings: {valueString: '0'},

  activate: (initialInputs, onOutputChange, functionArguments, initialSettings) => {
    let currentSettings = initialSettings;

    const updateOutput = () => {
      let value = undefined;
      try {
        value = eval('(' + currentSettings.valueString + ')');
      } catch(e) {
        // ignore
      }
      onOutputChange(value);
    };

    updateOutput();

    return {
      changeSettings: (newSettings) => {
        currentSettings = newSettings;
      },

      update: () => {
        updateOutput();
      },
    };
  },

  ui: class {
    constructor(container, initialSettings, changeSettings) {
      this.inputElem = document.createElement('input');
      this.inputElem.value = initialSettings.valueString;
      container.appendChild(this.inputElem);
      this.onChange = () => {
      };
      this.inputElem.addEventListener('change', () => {
        changeSettings({valueString: this.inputElem.value});
      }, false);
    }

    update(newSettings) {
      this.inputElem.textContent = newSettings.valueString;
    }
  },
};

export const consoleLog = {
  inputs: [
    {tempo: 'step'},
  ],
  output: null,

  activate: (initialInputs) => {
    const log = (v) => {
      console.log('consoleLog', v);
    }

    log(initialInputs[0].value);

    return {
      update: (inputs) => {
        log(inputs[0].value);
      }
    };
  }
}

export const displayAsString = {
  inputs: [
    {tempo: 'step'},
  ],
  output: null,

  activate: (initialInputs, onOutputChange) => {
    const divElem = document.createElement('div');
    divElem.style.cssText = 'position: absolute; top: 0; right: 0; pointer-events: none; background: white; border: 1px solid red; color: black; font-size: 24px; padding: 5px';
    divElem.textContent = '(undefined)';
    document.body.appendChild(divElem);

    const set = (v) => {
      divElem.textContent = (v === undefined) ? '(undefined)' : v.toString();
    };

    set(initialInputs[0].value);

    return {
      update: (inputs) => {
        set(inputs[0].value);
      },
      destroy: () => {
        document.body.removeChild(divElem);
      },
    };
  },
};

export const animationTime = {
  inputs: [],
  output: {tempo: 'step'},

  activate: (initialInputs, onOutputChange) => {
    let reqId;

    const onFrame = (time) => {
      onOutputChange(0.001*time);
      reqId = requestAnimationFrame(onFrame);
    };

    // Set initial output to reasonable value and kick off updates
    onFrame(performance.now());

    return {
      destroy: () => {
        cancelAnimationFrame(reqId);
      },
    };
  },
};

export const mouseDown = {
  inputs: [],
  output: {tempo: 'step'},

  activate: (initialInputs, onOutputChange) => {
    const onMouseDown = () => {
      onOutputChange(true);
    };

    const onMouseUp = () => {
      onOutputChange(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    // Set initial output (we assume up, but will be fine if already up)
    onOutputChange(false);

    return {
      destroy: () => {
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mouseup', onMouseUp);
      }
    };
  },
};

export const mousePos = {
  inputs: [],
  output: {tempo: 'step'},

  activate: (initialInputs, onOutputChange) => {
    const onMouseMove = (e) => {
      onOutputChange({
        x: e.clientX || e.pageX,
        y: e.clientY || e.pageY,
      });
    };

    document.addEventListener('mousemove', onMouseMove);

    // Initial output (before any movement) must be 0,0 unfortunately, can't poll mouse position
    onOutputChange({x: 0, y: 0});

    return {
      destroy: () => {
        document.removeEventListener('mousemove', onMouseMove);
      },
    };
  },
};

// TODO: Should we hide it if input coords are undefined?
export const redSquare = {
  inputs: [
    {tempo: 'step', name: 'position'},
  ],
  output: null,

  activate: (initialInputs, onOutputChange) => {
    const squareElem = document.createElement('div');
    squareElem.style.cssText = 'position: absolute; width: 20px; height: 20px; border: 1px solid black; background: red; pointer-events: none;';
    document.body.appendChild(squareElem);

    const update = (inputs) => {
      const p = inputs[0].value;
      if (p === undefined) {
        return;
      }

      squareElem.style.left = p.x + 'px';
      squareElem.style.top = p.y + 'px';
    };

    update(initialInputs);

    return {
      update: (inputs) => {
        update(inputs);
      },

      destroy: () => {
        document.body.removeChild(squareElem);
      },
    };
  },
};

export const map = {
  functionParameters: {
    f: {
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    },
  },
  inputs: [
    {tempo: 'step'},
  ],
  output: {tempo: 'step'},

  activate: (initialInputs, onOutputChange, functionArguments) => {
    const f = functionArguments.get('f');
    const activationsValues = [];
    let updating = false; // we use this to determine when outputs are async

    const emitOutput = () => {
      onOutputChange(activationsValues.map(av => av.value));
    };

    const update = (arr) => {
      arr = arr || [];

      // Trim any excess activations
      if (activationsValues.length > arr.length) {
        for (let i = arr.length; i < activationsValues.length; i++) {
          activationsValues[i].activation.destroy();
        }
        activationsValues.length = arr.length;
      }

      updating = true;
      let anyOutputChanged = false;

      // Push array values to all current activations
      for (let i = 0; i < activationsValues.length; i++) {
        activationsValues[i].activation.update([{value: arr[i], changed: true}]);
      }

      // Create any new activations, pushing initial values
      if (activationsValues.length < arr.length) {
        anyOutputChanged = true; // Even if sub-act doesn't output, it will add undefined to output array
        for (let i = activationsValues.length; i < arr.length; i++) {
          activationsValues.push({
            activation: undefined,
            value: undefined,
          });

          (idx => {
            activationsValues[idx].activation = f.activate([{value: arr[idx], changed: true}], (changedOutput) => {
              activationsValues[idx].value = changedOutput;

              if (updating) {
                // We wait to collect all changed outputs before we emit the result array
                anyOutputChanged = true;
              } else {
                // This means the sub-activation output was async, so we async emit our array output
                emitOutput();
              }
            });
          })(i);
        }
      }

      if (anyOutputChanged) {
        emitOutput();
      }

      updating = false;
    };

    // Handle initial inputs
    update(initialInputs[0].value);

    return {
      update: (inputs) => {
        update(inputs[0].value);
      },
      destroy: () => {
        for (const av of activationsValues) {
          av.activation.destroy();
        }
      },
      definitionChanged: (subdefPath) => {
        if (subdefPath.length < 1) {
          throw new Error('internal error');
        }
        const firstSubdef = subdefPath[0];
        const restSubdefs = subdefPath.slice(1);
        if (firstSubdef !== f) {
          throw new Error('internal error');
        }

        for (const av of activationsValues) {
          av.activation.definitionChanged(restSubdefs);
        }
      },
    };
  },
};

/////////////////////////////////////////////////////////////////////////////
// STILL NEED UPDATING BELOW THIS POINT

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
    for (const act of context.activations) {
      act.destroy();
    }
  },
};

export const mouseInt = {
  inputs: {},
  outputs: {
    v: {tempo: 'step'},
  },

  create: (context) => {
    const onMouseMove = (e) => {
      const x = e.clientX || e.pageX;
      const y = e.clientY || e.pageY;
      const v = Math.floor(0.01*Math.sqrt(x*x + y*y));
      context.setOutputs({
        v,
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    context.transient = { onMouseMove };

    // Initial output (before any movement) must be 0 unfortunately, can't poll mouse position
    context.setOutputs({v: 0});
  },

  destroy: (context) => {
    document.removeEventListener('mousemove', context.transient.onMouseMove);
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
