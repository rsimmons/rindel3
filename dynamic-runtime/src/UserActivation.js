import assert from './assert';
import PriorityQueue from './PriorityQueue';
import Stream from './Stream';
import activateNativeDefinition from './activateNativeDefinition';
import UserClosure from './UserClosure';

// Activation of a user-defined (not native) function. This is the "internal" bookkeeping/state of the activation.
export default class UserActivation {
  constructor(definition, containingActivation, setOutput, functionArguments) {
    this.definition = definition;

    // sanity check containingActivation
    if (containingActivation) {
      assert(containingActivation.definition === definition.containingDefinition);
    } else {
      assert(!definition.containingDefinition);
    }
    if (containingActivation) {
      containingActivation.activatedClosureOfContainedDefinition(this.definition, this);
    }
    this.containingActivation = containingActivation; // the activation of our containing definition, i.e. our lexical outer scope

    this.setOutput = setOutput;

    // Maps from OutPort and InPort objects to their corresponding Stream objects for this activation
    this.outPortStream = new Map();
    this.inPortStream = new Map();

    this.evaluating = false;
    this.priorityQueue = new PriorityQueue();
    this.currentInstant = 1; // before pump this is next instant, during pump it's current instant

    // Map from native applications (within this user-defined function) to their activation wrappers (NativeApplication -> ApplicationWrapper)
    //  We need this so that we can deactivate these activations if we remove the native application.
    this.containedNativeApplicationActivationControl = new Map();

    // Map from UserDefinition (contained by this activation's definition) to a Set of its activations scoped under this activation
    this.containedDefinitionActivations = new Map();

    // Create streams for "internal side" of function inputs and outputs
    for (const outPort of definition.definitionInputs) {
      const outStream = new Stream();
      this.outPortStream.set(outPort, outStream);
    }

    if (definition.definitionOutput instanceof Map) {
      for (const [n, inPort] of definition.definitionOutput) {
        const inStream = new Stream();
        this.inPortStream.set(inPort, inStream);
      }
    } else if (definition.definitionOutput) {
      const inStream = new Stream();
      this.inPortStream.set(definition.definitionOutput, inStream);
    }

    // Activate native applications (which will create streams, pulling in initial values if any).
    // This needs to be done in topological sort order, but we keep them ordered so it's easy. 
    for (const napp of definition.nativeApplications) {
      this._activateNativeApplication(napp);
    }
  }

  evaluate(inputs = []) {
    assert(inputs.length === this.definition.definitionInputs.length);

    assert(!this.evaluating);
    this.evaluating = true;

    for (let i = 0; i < inputs.length; i++) {
      const outPort = this.definition.definitionInputs[i];
      const outStream = this.outPortStream.get(outPort);

      const v = inputs[i];
      if (outPort.tempo === 'step') {
        if (v.changed) {
          this._setFlowOutPort(outPort, v.value);
        }
      } else if (outPort.tempo === 'event') {
        if (v.present) {
          this._setFlowOutPort(outPort, v.value);
        }
      } else {
        assert(false);
      }
    }

    // Pump to process these updated inputs
    this.pump();

    this.evaluating = false;
  }

  destroy() {
    for (const act of this.containedNativeApplicationActivationControl.values()) {
      act.destroy();
    }

    if (this.containingActivation) {
      this.containingActivation.deactivatedClosureOfContainedDefinition(this.definition, this);
    }

    this.definition.activationDeactivated(this);
  }

  definitionChanged(subdefPath) {
    assert(!this.evaluating);
    this.evaluating = true;

    if (subdefPath.length > 0) {
      const firstSubdef = subdefPath[0];
      const restSubdefs = subdefPath.slice(1);

      // These are the activations that could care about the subdef having changed
      const apps = this.definition.definitionToUsingApplications.get(firstSubdef);
      for (const app of apps) {
        const actControl = this.containedNativeApplicationActivationControl.get(app);

        // NOTE: We pass the full path here rather than slicing off the first one
        actControl.definitionChanged(subdefPath);
      }
    }

    this.pump();
    this.evaluating = false;
  }

  // Let the activation know that a native application was added to the definition
  addedNativeApplication(app) {
    assert(!this.evaluating);

    this._activateNativeApplication(app);
  }

  // Let the activation know that a native application was removed from the definition
  removedNativeApplication(app) {
    assert(!this.evaluating);

    const actControl = this.containedNativeApplicationActivationControl.get(app);

    actControl.destroy();
  }

  // Let the activation know that a connection was added to the definition
  addedConnection(cxn) {
    assert(!this.evaluating);

    // NOTE: I think it should not be necessary to flow the connection if the ports are event-tempo,
    // but that's not a very important optimization.
    this._flowConnection(cxn);
  }

  // Let the activation know that a connection was removed from the definition
  removedConnection(cxn) {
    assert(!this.evaluating);

    // Flow the removal of the connection
    this._flowConnection(cxn, true);
  }

  // Set the settings on an application
  setApplicationSettings(app, newSettings) {
    const actControl = this.containedNativeApplicationActivationControl.get(app);
    actControl.changeSettings(newSettings);

    this._insertAppEvalTask(app);
  }

  // Let this activation know that a closure made from one of its contained definitions was activated
  activatedClosureOfContainedDefinition(definition, activation) {
    assert(definition.containingDefinition === this.definition);
    if (!this.containedDefinitionActivations.has(definition)) {
      this.containedDefinitionActivations.set(definition, new Set());
    }
    this.containedDefinitionActivations.get(definition).add(activation);
  }

  // Let this activation know that a closure made from one of its contained definitions was deactivated
  deactivatedClosureOfContainedDefinition(definition, activation) {
    assert(definition.containingDefinition === this.definition);
    this.containedDefinitionActivations.get(definition).delete(activation);
  }

  _gatherNativeApplicationInputs(nativeApplication, initial) {
    const inPortToValueChange = (inPort) => {
      const stream = this.inPortStream.get(inPort);

      if (inPort.tempo === 'step') {
        // NOTE: By convention we always set changed to true for initial inputs
        if (stream) {
          return {
            value: stream.latestValue,
            changed: initial ? true : (stream.lastChangedInstant === this.currentInstant),
          };
        } else {
          return {
            value: undefined,
            changed: true,
          };
        }
      } else if (inPort.tempo === 'event') {
        // For event-tempo ports, we only provide a value if there is an event present (at the
        // current instant)
        if (stream && (stream.lastChangedInstant === this.currentInstant)) {
          return {
            value: stream.latestValue,
            present: true,
          };
        } else {
          return {
            value: undefined,
            present: false,
          };
        }
      } else {
        assert(false);
      }
    }

    const inputs = [];

    for (const inPort of nativeApplication.inputs) {
      inputs.push(inPortToValueChange(inPort));
    }

    return inputs;
  }

  // Activate a native application, which is to say activate a native definition within the context of a user activation.
  // This will create output streams and set their initial values.
  // No return value.
  _activateNativeApplication(nativeApplication) {
    // Create streams for the output ports of the native function definition,
    //  and store the streams in the containing activation.

    // Create and store the streams
    for (const inPort of nativeApplication.inputs) {
      const stream = new Stream();
      this.inPortStream.set(inPort, stream);
    }

    const outStreams = []; // We'll use this below
    if (nativeApplication.output instanceof Map) {
      // Compound output
      for (const [n, outPort] of nativeApplication.output) {
        const stream = new Stream();
        this.outPortStream.set(outPort, stream);
        outStreams.push(stream);
      }
    } else if (nativeApplication.output) {
      // Single output
      const stream = new Stream();
      this.outPortStream.set(nativeApplication.output, stream);
      outStreams.push(stream);
    }

    // Create setOutput callback that sets/flows the changed output streams
    const setOutput = (outVal) => {
      if (nativeApplication.output instanceof Map) {
        // Compound output
        for (const [n, v] of outVal) {
          this._setFlowOutPort(nativeApplication.output.get(n), v);
        }
      } else if (nativeApplication.output) {
        // Single output
        this._setFlowOutPort(nativeApplication.output, outVal);
      } else {
        assert(false); // callback should not be called if no outputs
      }

      // If we aren't already evaluating, then this must have been a async output, so we start evaluating.
      // NOTE: We could set a flag when we enter/exit activation and update calls to determine
      // whether this call is truly async or not, and use this as a sanity check against the
      // current state of the evaluating flag (this.evaluating iff not-async-output).
      if (!this.evaluating) {
        this.evaluating = true;
        this.pump();
        this.evaluating = false;
      }
    };

    // Create "closures" where we bind the function args of this application to this activation
    const functionArguments = new Map();
    if (nativeApplication.functionArguments) {
      for (const [n, f] of nativeApplication.functionArguments) {
        functionArguments.set(n, new UserClosure(f, this));
      }
    }

    const activationControl = activateNativeDefinition(nativeApplication.definition, setOutput, functionArguments, nativeApplication.settings);

    // Store the new activation in the containing activation
    this.containedNativeApplicationActivationControl.set(nativeApplication, activationControl);

    // Insert a task to do the initial evaluation of this application's activation
    this._insertAppEvalTask(nativeApplication);
  }

  _insertAppEvalTask(app) {
    const priority = app.sortIndex;
    assert(priority !== undefined);
    this.priorityQueue.insert(priority, {
      tag: 'napp',
      nativeApplication: app,
    });
  }

  _notifyInPort(inPort) {
    // See what task is associated with notifying inPort, and insert an element
    // into the priority queue, associated with this activation.
    const owner = inPort.owner;
    switch (owner.tag) {
      case 'napp':
        this._insertAppEvalTask(owner.nativeApplication);
        break;

      case 'def':
        this.priorityQueue.insert(Infinity, {
          tag: 'defout',
        });
        break;

      default:
        assert(false);
    }
  }

  // Propagate value change along the given connection within the context of the given activation (at the source/out side),
  //  and "notify" any input ports whose values have changed. We create the downstream Stream object if it doesn't already exist.
  //  If removal argument is true, then flow an undefined value along the connection (because connection is being removed).
  _flowConnection(cxn, removal = false) {
    // TODO: Handle connections that enter a contained definition
    assert(cxn.path.length === 0);

    let flowValue;
    if (removal) {
      flowValue = undefined;
    } else {
      // NOTE: The lastChangedInstant of outStream may not be the current instant,
      // e.g. if this copying is the result of flowing a newly added connection.
      const outStream = this.outPortStream.get(cxn.outPort);
      flowValue = outStream.latestValue;
    }

    const inStream = this.inPortStream.get(cxn.inPort);

    // TODO: Ensure that inStream's last changed instant is less than current instant?
    inStream.setValue(flowValue, this.currentInstant);

    // Trigger anything "listening" on this port
    this._notifyInPort(cxn.inPort);
  }

  // Set the value of the given outPort in the context of activation (which corresponds to a specific stream),
  //  and flow the change along any outgoing connections.
  // NOTE: We take a OutPort+UserActivation rather than Stream because we need the OutPort to find connections.
  _setFlowOutPort(outPort, value) {
    // Set the stream value
    const outStream = this.outPortStream.get(outPort);
    // TODO: ensure that stream's last changed instant is less than current instant?
    outStream.setValue(value, this.currentInstant);

    // Flow the change
    for (const cxn of outPort.connections) {
      this._flowConnection(cxn);
    }
  }

  _emitOutput(mustBePresent) {
    // Check definition-output stream(s), and if any have changed then call this.setOutput.
    // If mustBePresent is true, then assert if no changes were found.
    // NOTE: We only emit outputs that have changed.
    if (this.definition.definitionOutput instanceof Map) {
      const changedOutputs = new Map();

      for (const [n, inPort] of this.definition.definitionOutput) {
        const stream = this.inPortStream.get(inPort);

        if (stream && (stream.lastChangedInstant === this.currentInstant)) {
          changedOutputs.set(n, stream.latestValue);
        }
      }

      assert(!(mustBePresent && changedOutputs.size === 0));

      if (changedOutputs.size) {
        this.setOutput(changedOutputs);
      }
    } else if (this.definition.definitionOutput) {
      const stream = this.inPortStream.get(this.definition.definitionOutput);

      if (stream && (stream.lastChangedInstant === this.currentInstant)) {
        this.setOutput(stream.latestValue);
      }
    } else {
      assert(!mustBePresent);
    }
  }

  _priorityQueueTasksEqual(a, b) {
    if (a.tag !== b.tag) {
      return false;
    }

    switch (a.tag) {
      case 'napp':
        return (a.nativeApplication === b.nativeApplication);

      default:
        assert(false);
    }
    return (a.task === b.task) && (a.activation === b.activation);
  }

  pump() {
    assert(this.evaluating);

    const pq = this.priorityQueue;
    const instant = this.currentInstant;

    while (!pq.isEmpty()) {
      const task = pq.pop();

      // Keep popping and discarding as long as next element is a duplicate
      while (!pq.isEmpty() && this._priorityQueueTasksEqual(pq.peek(), task)) {
        pq.pop();
      }

      switch (task.tag) {
        case 'napp':
          const {nativeApplication} = task;
          const activationControl = this.containedNativeApplicationActivationControl.get(nativeApplication);
          const inputs = this._gatherNativeApplicationInputs(nativeApplication, false);
          activationControl.evaluate(inputs);
          break;

        case 'defout':
          this._emitOutput(true);
          break;

        default:
          assert(false);
      }
    }

    this.currentInstant++;
  }
}
