import assert from './assert';

export function activateNativeDefinition(definition, initialInputs, onOutputChange, functionArguments) {
  // This callback is just a thin wrapper that converts formats (for now) and chains to the provided onOutputChange
  const setOutputs = (changedOutputs) => {
    const changedOutputsMap = new Map();

    for (const n in changedOutputs) {
      changedOutputsMap.set(n, changedOutputs[n]);
    }

    onOutputChange(changedOutputsMap);
  };

  // Build context object that we provide to the native function implementation
  const context = {
    setOutputs,
    state: null,
    // TODO: can we define setState without a closure?
    setState: (newState) => {
      // TODO: Do we want to immediately reflect state update? Perhaps there is no harm
      context.state = newState;
    },
    transient: null,
  };

  // Call create if the node has it. This doesn't return anything,
  //  but may call functions in context to set outputs, store state, etc.
  if (definition.create) {
    definition.create(context);
  }

  // TODO: supply initial inputs via a call to update?

  const update = (inputs) => {
    // Massage inputs into the right structure
    const convertedInputs = {};
    for (const k in definition.inputs) {
      assert(inputs.has(k));
      convertedInputs[k] = inputs.get(k);
    }

    definition.update(context, convertedInputs);
  };

  const destroy = () => {
    // Call underlying destroy function, if present
    if (definition.destroy) {
     definition.destroy(context);
    }
  };

  return {
    update,
    destroy,
  };
}
