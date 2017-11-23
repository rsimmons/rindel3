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
      onOutputChange(time);
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
    update(initialInputs[0]);

    return {
      update: (inputs) => {
        update(inputs[0]);
      },
      destroy: () => {
        for (const av of activationsValues) {
          av.activation.destroy();
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
