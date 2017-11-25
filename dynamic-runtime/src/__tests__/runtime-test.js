'use strict';

import UserDefinition from '../UserDefinition';

describe('runtime', () => {
  test('user defined identity function', () => {
    const def = new UserDefinition(null, {
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    });

    def.addConnection(def.definitionInputs[0], def.definitionOutput);

    const outputs = [];
    const act = def.activate([{value: 123, changed: true}], (output) => {
      outputs.push(output);
    });

    expect(outputs).toEqual([123]);

    act.update([{value: 456, changed: true}]);

    expect(outputs).toEqual([123, 456]);
  });
});
