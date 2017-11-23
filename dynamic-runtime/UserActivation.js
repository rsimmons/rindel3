import assert from './assert';
import PriorityQueue from './PriorityQueue';
import Stream from './Stream';
import { activateNativeDefinition } from './nativeDefinition';

// Activation of a user-defined (not native) function. This is the "internal" bookkeeping/state of the activation.
export default class UserActivation {
  constructor(definition, initialInputs, onOutputChange, functionArguments) {
    this.definition = definition;
    this.onOutputChange = onOutputChange;

    // Maps from OutPort and InPort objects to their corresponding Stream objects for this activation
    this.outPortStream = new Map();
    this.inPortStream = new Map();

    this.pumping = false; // is there currently a call to pump() running?
    this.priorityQueue = new PriorityQueue(); // this should be empty unless we are pumping
    this.currentInstant = 1; // before pump this is next instant, during pump it's current instant

    // Map from native applications (within this user-defined function) to their activation wrappers (NativeApplication -> ApplicationWrapper)
    //  We need this so that we can deactivate these activations if we remove the native application.
    this.containedNativeApplicationActivationControl = new Map();

    this.initializing = true;

    // Create streams for internal side of function inputs, setting+flowing initial values from initialInputs
    for (const [n, outPort] of definition.definitionInputs) {
      const stream = new Stream();
      this.outPortStream.set(outPort, stream);
      this._setFlowOutPort(outPort, initialInputs.get(n).value);
    }

    // Activate native applications (which will create streams, pulling in initial values if any).
    // This needs to be done in topological sort order, but we keep them ordered so it's easy. 
    for (const napp of definition.nativeApplications) {
      this._activateNativeApplication(napp);
    }

    // Check if we have any immediate/initial output
    this._emitOutput(false);

    this.initializing = false;
  }

  update(inputs) {
    for (const [k, v] of inputs) {
      assert(this.definition.definitionInputs.has(k)); // TODO: could ignore?

      const outPort = this.definition.definitionInputs.get(k);
      const outStream = this.outPortStream.get(outPort);

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
    assert(!this.pumping);
    this.pump();
  }

  destroy() {
    for (const act of this.containedNativeApplicationActivationControl.values()) {
      act.destroy();
    }

    this.definition.activationDeactivated(this);
  }

  // Let the activation know that a native application was added to the definition
  addedNativeApplication(app) {
    assert(!this.pumping); // TODO: necessary/useful?

    this._activateNativeApplication(app);

    // TODO: Might we need to pump? Not sure if it's necessary. For now, assert that there is nothing to be pumped.
    assert(this.priorityQueue.isEmpty());
  }

  // Let the activation know that a connection was added to the definition
  addedConnection(cxn) {
    assert(!this.pumping); // TODO: necessary/useful?

    // NOTE: I think it should not be necessary to flow the connection if the ports are event-tempo,
    // but that's not a very important optimization.
    this._flowConnection(cxn);
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

    // Gather initial inputs from streams
    const initialInputs = this._gatherNativeApplicationInputs(nativeApplication, true);

    // Create onOutputChange callback that sets/flows the changed output streams
    const onOutputChange = (outVal) => {
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

      // If we aren't already pumping, then this must have been a async output, so we start pumping.
      // NOTE: We could set a flag when we enter/exit activation and update calls to determine
      // whether this call is truly async or not, and use this as a sanity check against the
      // current state of the pumping flag (this.pumping iff not-async-output).
      if (!this.pumping) {
        this.pump();
      }
    };

    const activationControl = activateNativeDefinition(nativeApplication.definition, initialInputs, onOutputChange, nativeApplication.functionArguments);

    // If lastChangedInstant is still undefined on any output streams, set it to current instant
    for (const stream of outStreams) {
      if (stream.lastChangedInstant === undefined) {
        stream.lastChangedInstant = this.currentInstant;
      }
    }

    // Store the new activation in the containing activation
    this.containedNativeApplicationActivationControl.set(nativeApplication, activationControl);
  }

  _notifyInPort(inPort) {
    // See what task is associated with notifying inPort, and insert an element
    // into the priority queue, associated with this activation.
    const owner = inPort.owner;
    let priority;
    let task;
    switch (owner.tag) {
      case 'napp':
        const nativeApplication = owner.nativeApplication;
        priority = nativeApplication.sortIndex;
        assert(priority !== undefined);
        task = {
          tag: 'napp',
          nativeApplication,
        }
        break;

      case 'def':
        priority = Infinity;
        task = {
          tag: 'defout',
        }
        break;

      default:
        assert(false);
    }

    this.priorityQueue.insert(priority, task);
  }

  // Propagate value change along the given connection within the context of the given activation (at the source/out side),
  //  and "notify" any input ports whose values have changed. We create the downstream Stream object if it doesn't already exist.
  // TODO: We could use this same function to flow an undefined when we disconnect a connection. Could take an optional "value override" parameter
  _flowConnection(cxn) {
    // TODO: Handle connections that enter a contained definition
    assert(cxn.path.length === 0);

    const outStream = this.outPortStream.get(cxn.outPort);
    const inStream = this.inPortStream.get(cxn.inPort); // NOTE: May be undefined

    // NOTE: The lastChangedInstant of outStream may not be the current instant,
    // e.g. if this copying is the result of flowing a newly added connection.
    if (inStream) {
      // TODO: ensure that stream's last changed instant is less than current instant?
      inStream.setValue(outStream.latestValue, this.currentInstant);
    } else {
      this.inPortStream.set(cxn.inPort, new Stream(outStream.latestValue, this.currentInstant));
    }

    // Don't trigger updating stuff when we're initializing.
    if (!this.initializing) {
      this._notifyInPort(cxn.inPort); // trigger anything "listening" on this port
    }
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
    // Check definition-output stream(s), and if any have changed then call this.onOutputChange.
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
        this.onOutputChange(changedOutputs);
      }
    } else if (this.definition.definitionOutput) {
      const stream = this.inPortStream.get(inPort);

      if (stream && (stream.lastChangedInstant === this.currentInstant)) {
        this.onOutputChange(stream.latestValue);
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
    assert(!this.pumping);
    this.pumping = true;

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
          activationControl.update(inputs);
          break;

        case 'defout':
          this._emitOutput(true);
          break;

        default:
          assert(false);
      }
    }

    this.currentInstant++;
    this.pumping = false;
  }
}
