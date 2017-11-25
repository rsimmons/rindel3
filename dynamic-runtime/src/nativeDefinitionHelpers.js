export function buildConstant(value) {
  return {
    inputs: [],
    output: {tempo: 'step'},

    activate: (initialInputs, onOutputChange) => {
      onOutputChange(value);
      return {};
    },
  };
}

export function buildPointwiseUnary(f) {
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

export function buildPointwiseBinary(f, filterUndef) {
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
