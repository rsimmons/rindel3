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

  test('adding two constants into sink output', () => {
    const const2Def = buildConstant(2);
    const const3Def = buildConstant(3);

    const mockAdd = jest.fn((a, b) => a + b);
    const addDef = buildPointwiseBinary(mockAdd);

    const mockSink = jest.fn();
    const sinkDef = buildSink(mockSink);

    const def = new UserDefinition();
    const const2App = def.addNativeApplication(const2Def);
    const const3App = def.addNativeApplication(const3Def);
    const addApp = def.addNativeApplication(addDef);
    const sinkApp = def.addNativeApplication(sinkDef);

    def.addConnection(const2App.output, addApp.inputs[0]);
    def.addConnection(const3App.output, addApp.inputs[1]);
    def.addConnection(addApp.output, sinkApp.inputs[0]);

    expect(mockAdd).not.toBeCalled();
    expect(mockSink).not.toBeCalled();

    const outputCallback = jest.fn();
    const act = def.activate([], outputCallback);

    expect(outputCallback).not.toBeCalled();

    expect(mockAdd.mock.calls.length).toBe(1);
    expect(mockSink.mock.calls).toEqual([[5]]);
  });
});
