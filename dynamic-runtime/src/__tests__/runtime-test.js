'use strict';

import { createRootUserClosure } from '../..';
import { buildConstant, buildPointwiseUnary, buildPointwiseBinary, buildSink } from '../nativeDefinitionHelpers';

describe('runtime', () => {
  test('user defined identity function', () => {
    const closure = createRootUserClosure({
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    });
    const def = closure.definition;

    def.addConnection(def.definitionInputs[0], def.definitionOutput);

    const outputCallback = jest.fn();
    const act = closure.activate(outputCallback);

    expect(outputCallback).not.toBeCalled();

    act.evaluate([{value: 123, changed: true}]);

    expect(outputCallback.mock.calls).toEqual([[123]]);
    outputCallback.mockClear();

    act.evaluate([{value: 456, changed: true}]);

    expect(outputCallback.mock.calls).toEqual([[456]]);
  });

  test('user defined identity function, adding connection after activation', () => {
    const closure = createRootUserClosure({
      inputs: [
        {tempo: 'step'},
      ],
      output: {tempo: 'step'},
    });
    const def = closure.definition;

    const outputCallback = jest.fn();
    const act = closure.activate(outputCallback);

    expect(outputCallback).not.toBeCalled();

    act.evaluate([{value: 123, changed: true}]);

    // NOTE: Since connection hasn't been made, output will still be undefined
    // TODO: We might change expectation to be that outputCallback is called with undefined value
    expect(outputCallback).not.toBeCalled();
    outputCallback.mockClear();

    def.addConnection(def.definitionInputs[0], def.definitionOutput);

    expect(outputCallback.mock.calls).toEqual([[123]]);
    outputCallback.mockClear();

    act.evaluate([{value: 456, changed: true}]);

    expect(outputCallback.mock.calls).toEqual([[456]]);
  });

  test('constant connected to definition out', () => {
    const closure = createRootUserClosure({
      inputs: [],
      output: {tempo: 'step'},
    });
    const def = closure.definition;

    const constDef = buildConstant(123);

    const constApp = def.addNativeApplication(constDef);

    def.addConnection(constApp.output, def.definitionOutput);

    const outputCallback = jest.fn();
    const act = closure.activate(outputCallback);

    expect(outputCallback).not.toBeCalled();

    act.evaluate();

    expect(outputCallback.mock.calls).toEqual([[123]]);
  });

  test('adding two constants into sink output', () => {
    const const2Def = buildConstant(2);
    const const3Def = buildConstant(3);

    const mockAdd = jest.fn((a, b) => a + b);
    const addDef = buildPointwiseBinary(mockAdd);

    const mockSink = jest.fn();
    const sinkDef = buildSink(mockSink);

    const closure = createRootUserClosure();
    const def = closure.definition;
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
    const act = closure.activate(outputCallback);

    // Nothing should have been called yet since we haven't done first evaluate()
    expect(outputCallback).not.toBeCalled();
    expect(mockAdd).not.toBeCalled();
    expect(mockSink).not.toBeCalled();

    act.evaluate();

    expect(outputCallback).not.toBeCalled();
    expect(mockAdd.mock.calls.length).toBe(1);
    expect(mockSink.mock.calls).toEqual([[5]]);
  });

  test('removing connection via disconnectPort from either end', () => {
    const constDef = buildConstant(123);

    const mockSink = jest.fn();
    const sinkDef = buildSink(mockSink);

    const closure = createRootUserClosure();
    const def = closure.definition;
    const constApp = def.addNativeApplication(constDef);
    const sinkApp = def.addNativeApplication(sinkDef);
    const act = closure.activate();

    expect(mockSink).not.toBeCalled(); // sanity check

    act.evaluate();
    // Since there is no connection and we did initial eval, sink will get eval'd with undefined
    expect(mockSink.mock.calls).toEqual([[undefined]]);
    mockSink.mockClear();

    def.addConnection(constApp.output, sinkApp.inputs[0]);

    expect(mockSink.mock.calls).toEqual([[123]]);
    mockSink.mockClear();

    // disconnect from output end
    def.disconnectPort(constApp.output);

    expect(mockSink.mock.calls).toEqual([[undefined]]);
    mockSink.mockClear();

    // re-add connection
    def.addConnection(constApp.output, sinkApp.inputs[0]);

    expect(mockSink.mock.calls).toEqual([[123]]);
    mockSink.mockClear();

    // disconnect from input end
    def.disconnectPort(sinkApp.inputs[0]);

    expect(mockSink.mock.calls).toEqual([[undefined]]);
    mockSink.mockClear();
  });
});
