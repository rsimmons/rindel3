export function buildConstant(value) {
  return {
    inputs: [],
    output: {tempo: 'step'},

    activation: class {
      constructor(setOutput) {
        this.setOutput = setOutput;
      }

      evaluate() {
        this.setOutput(value);
      }
    },
  };
}

export function buildPointwiseUnary(f) {
  return {
    inputs: [
      {tempo: 'step'},
    ],
    output: {tempo: 'step'},

    activation: class {
      constructor(setOutput) {
        this.setOutput = setOutput;
      }

      evaluate([v]) {
        this.setOutput(f(v.value));
      }
    },
  };
}

export function buildPointwiseBinary(f, filterUndef) {
  return {
    inputs: [
      {tempo: 'step'},
      {tempo: 'step'},
    ],
    output: {tempo: 'step'},

    activation: class {
      constructor(setOutput) {
        this.setOutput = setOutput;
      }

      evaluate([a, b]) {
        const av = a.value;
        const bv = b.value;

        if (filterUndef && ((av === undefined) || (bv === undefined))) {
          this.setOutput(undefined);
        } else {
          this.setOutput(f(av, bv));
        }
      }
    },
  };
}

export function buildSink(f) {
  return {
    inputs: [
      {tempo: 'step'},
    ],
    output: null,

    activation: class {
      constructor(setOutput) {
        this.setOutput = setOutput;
      }

      evaluate([v]) {
        f(v.value);
      }
    },
  };
}
