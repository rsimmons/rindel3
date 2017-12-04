import { nativeDefinitionHelpers } from 'dynamic-runtime';

const {buildConstant, buildPointwiseUnary, buildPointwiseBinary, buildSink} = nativeDefinitionHelpers;

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
export const sub = buildPointwiseBinary((a, b) => a - b);
export const mul = buildPointwiseBinary((a, b) => a * b);
export const div = buildPointwiseBinary((a, b) => a / b);
export const vecAdd = buildPointwiseBinary((a, b) => ({x: a.x+b.x, y: a.y+b.y}), true);
export const vecDist = buildPointwiseBinary((a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}, true);

export const consoleLog = buildSink(v => { console.log('consoleLog', v) });

export const constantJS = {
  inputs: [],
  output: {tempo: 'step'},
  defaultSettings: {vs: '0'},

  activation: class {
    constructor(setOutput, functionArguments, initialSettings) {
      this.setOutput = setOutput;
      this.settings = initialSettings;
    }

    evaluate() {
      let value = undefined;
      try {
        value = eval('(' + this.settings.vs + ')');
      } catch(e) {
        // ignore
      }
      this.setOutput(value);
    }

    changeSettings(newSettings) {
      this.settings = newSettings;
    }
  },

  ui: class {
    constructor(container, initialSettings, changeSettings) {
      this.inputElem = document.createElement('input');
      this.inputElem.value = initialSettings.vs;
      container.appendChild(this.inputElem);
      this.onChange = () => {
      };
      this.inputElem.addEventListener('change', () => {
        changeSettings({vs: this.inputElem.value});
      }, false);
    }

    update(newSettings) {
      this.inputElem.textContent = newSettings.vs;
    }
  },
};

export const displayAsString = {
  inputs: [
    {tempo: 'step'},
  ],
  output: null,

  activation: class {
    constructor(setOutput) {
      this.setOutput = setOutput;

      this.divElem = document.createElement('div');
      this.divElem.style.cssText = 'position: absolute; top: 0; right: 0; pointer-events: none; background: white; border: 1px solid red; color: black; font-size: 24px; padding: 5px';
      this.divElem.textContent = '(undefined)';
      document.body.appendChild(this.divElem);
    }

    evaluate(inputs) {
      const v = inputs[0].value;
      this.divElem.textContent = (v === undefined) ? '(undefined)' : v.toString();
    }

    destroy() {
      document.body.removeChild(this.divElem);
    }
  },
};

export const animationTime = {
  inputs: [],
  output: {tempo: 'step'},

  activation: class {
    constructor(setOutput) {
      this.setOutput = setOutput;
      this.onFrame = this.onFrame.bind(this);
    }

    onFrame(time) {
      this.setOutput(0.001*time);
      this.reqId = requestAnimationFrame(this.onFrame);
    }

    evaluate() {
      // Set initial output to reasonable value and kick off updates
      this.onFrame(performance.now());
    }

    destroy() {
      cancelAnimationFrame(this.reqId);
    }
  },
};

export const mouseDown = {
  inputs: [],
  output: {tempo: 'step'},

  activation: class {
    constructor(setOutput) {
      this.setOutput = setOutput;

      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);

      document.addEventListener('mousedown', this.onMouseDown);
      document.addEventListener('mouseup', this.onMouseUp);
    }

    onMouseDown() {
      this.setOutput(true);
    }

    onMouseUp() {
      this.setOutput(false);
    }

    evaluate() {
      // Set initial output (we assume up, but will be fine if already up)
      this.setOutput(false);
    }

    destroy() {
      document.removeEventListener('mousedown', this.onMouseDown);
      document.removeEventListener('mouseup', this.onMouseUp);
    }
  },
};

export const mousePos = {
  inputs: [],
  output: {tempo: 'step'},

  activation: class {
    constructor(setOutput) {
      this.setOutput = setOutput;

      this.onMouseMove = this.onMouseMove.bind(this);

      document.addEventListener('mousemove', this.onMouseMove);
    }

    onMouseMove(e) {
      this.setOutput({
        x: e.clientX || e.pageX,
        y: e.clientY || e.pageY,
      });
    }

    evaluate() {
      // Initial output (before any movement) must be 0,0 unfortunately, can't poll mouse position
      this.setOutput({x: 0, y: 0});
    }

    destroy() {
      document.removeEventListener('mousemove', this.onMouseMove);
    }
  },
};

export const redCircle = {
  inputs: [
    {tempo: 'step', name: 'position'},
    {tempo: 'step', name: 'radius'},
  ],
  output: null,

  activation: class {
    constructor(setOutput) {
      this.setOutput = setOutput;

      this.circleElem = document.createElement('div');
      this.circleElem.style.cssText = 'position: absolute; border-radius: 50%; background: red; pointer-events: none; user-select: none';
      document.body.appendChild(this.circleElem);
    }

    evaluate(inputs) {
      // TODO: Should we hide it if the position is undefined?
      const p = inputs[0].value || {x: 0, y: 0};
      const radius = inputs[1].value || 25;
      if (radius < 0) {
        radius = 0;
      }
      const halfRadius = 0.5*radius;

      this.circleElem.style.left = (p.x - halfRadius) + 'px';
      this.circleElem.style.top = (p.y - halfRadius) + 'px';
      this.circleElem.style.width = radius + 'px';
      this.circleElem.style.height = radius + 'px';
    }

    destroy() {
      document.body.removeChild(this.circleElem);
    }
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

  activation: class {
    constructor(setOutput, functionArguments) {
      this.setOutput = setOutput;

      this.f = functionArguments.get('f');
      this.activationsValues = [];
      this.evaluatingSubacts = false; // we use this to determine when outputs are async
    }

    emitOutput() {
      this.setOutput(this.activationsValues.map(av => av.value));
    }

    evaluate(inputs) {
      const arr = inputs[0].value || [];

      this.needOutputUpdate = false;

      // Trim any excess activations
      if (this.activationsValues.length > arr.length) {
        this.needOutputUpdate = true;
        for (let i = arr.length; i < this.activationsValues.length; i++) {
          this.activationsValues[i].activation.destroy();
        }
        this.activationsValues.length = arr.length;
      }

      this.evaluatingSubacts = true;

      // Create any new activations
      if (this.activationsValues.length < arr.length) {
        this.needOutputUpdate = true; // Even if sub-act doesn't output, it will add undefined to output array
        for (let i = this.activationsValues.length; i < arr.length; i++) {
          this.activationsValues.push({
            activation: undefined,
            value: undefined,
          });

          (idx => {
            this.activationsValues[idx].activation = this.f.activate((changedOutput) => {
              this.activationsValues[idx].value = changedOutput;

              if (this.evaluatingSubacts) {
                // We wait to collect all changed outputs before we emit the result array
                this.needOutputUpdate = true;
              } else {
                // This means the sub-activation output was async, so we async emit our array output
                this.emitOutput();
              }
            });
          })(i);
        }
      }

      // Push array values to all current activations
      for (let i = 0; i < this.activationsValues.length; i++) {
        this.activationsValues[i].activation.evaluate([{value: arr[i], changed: true}]);
      }

      if (this.needOutputUpdate) {
        this.emitOutput();
      }

      this.evaluatingSubacts = false;
    }

    definitionChanged(subdefPath) {
      if (subdefPath.length < 1) {
        throw new Error('internal error');
      }

      this.evaluatingSubacts = true;

      const firstSubdef = subdefPath[0];
      const restSubdefs = subdefPath.slice(1);
      if (firstSubdef !== this.f.definition) {
        throw new Error('internal error');
      }

      for (const av of this.activationsValues) {
        av.activation.definitionChanged(restSubdefs);
      }

      if (this.needOutputUpdate) {
        this.emitOutput();
      }

      this.evaluatingSubacts = false;
    }

    destroy() {
      for (const av of this.activationsValues) {
        av.activation.destroy();
      }
    }
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
