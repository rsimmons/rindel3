'use strict';

import UserDefinition from '../UserDefinition';
import { buildConstant, buildPointwiseUnary, buildPointwiseBinary, buildSink } from '../nativeDefinitionHelpers';

describe('runtime', () => {
  test('user defined identity function', () => {
    const def = new UserDefinition(null, {
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    });

    def.addConnection(def.definitionInputs[0], def.definitionOutput);

    const outputCallback = jest.fn();
    const act = def.activate([{value: 123, changed: true}], outputCallback);

    expect(outputCallback.mock.calls).toEqual([[123]]);
    outputCallback.mockClear();

    act.update([{value: 456, changed: true}]);

    expect(outputCallback.mock.calls).toEqual([[456]]);
  });

  test('user defined identity function, adding connection after activation', () => {
    const def = new UserDefinition(null, {
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    });

    const outputCallback = jest.fn();
    const act = def.activate([{value: 123, changed: true}], outputCallback);

    // TODO: We might change expectation to be that outputCallback is called with undefined value
    expect(outputCallback).not.toBeCalled();
    outputCallback.mockClear();

    def.addConnection(def.definitionInputs[0], def.definitionOutput);

    expect(outputCallback.mock.calls).toEqual([[123]]);
    outputCallback.mockClear();

    act.update([{value: 456, changed: true}]);

    expect(outputCallback.mock.calls).toEqual([[456]]);
  });
});
