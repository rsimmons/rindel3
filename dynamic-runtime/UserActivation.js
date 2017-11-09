import assert from './assert';
import PriorityQueue from './PriorityQueue';
import Stream from './Stream';
import { activateNativeDefinition } from './nativeDefinition';

// Activation of a user-defined (not native) function. This is the "internal" bookkeeping/state of the activation.
export default class UserActivation {
  constructor(definition, initialInputs, onOutputChange, functionArguments) {
    // Maps from OutPort and InPort objects to their corresponding Stream objects for this activation
    this.outPortStream = new Map();
    this.inPortStream = new Map();

    this.pumping = false; // is there currently a call to pump() running?
    this.priorityQueue = new PriorityQueue(); // this should be empty unless we are pumping
    this.currentInstant = 1; // before pump this is next instant, during pump it's current instant

    // Map from native applications (within this user-defined function) to their activation wrappers (NativeApplication -> ApplicationWrapper)
    //  We need this so that we can deactivate these activations if we remove the native application.
    this.containedNativeApplicationActivationControl = new Map();

    // TODO: create streams for internal side of function inputs, setting initial values from initialInputs

    // Activate native applications (which will create streams, pulling in initial values if any).
    // This needs to be done in topological sort order, but we keep them ordered so it's easy. 
    for (const napp of definition.nativeApplications) {
      this._activateNativeApplication(napp);
    }

    // TODO: create streams for internal side of function outputs, flow in values
    // TODO: if we have immediate/initial output (check function-output streams), then call onOutputChange
  }

  update() {
    // TODO: implement. do _setFlowOutPort on corresponding input ports?
  }

  destroy() {
    // TODO: implement
  }

  _gatherNativeApplicationInputs(nativeApplication, initial) {
    const inputs = new Map();

    for (const [n, inPort] of nativeApplication.inPorts) {
      const stream = this.inPortStream.get(inPort);

      if (inPort.tempo === 'step') {
        inputs.set(n, {
          value: stream.latestValue,
           // NOTE: By convention we always set changed to true for initial inputs
          changed: initial ? true : (stream.lastChangedInstant === this.currentInstant),
        });
      } else if (inPort.tempo === 'event') {
        // For event-tempo ports, we only provide a value if there is an event present (at the
        // current instant)
        if (stream.lastChangedInstant === this.currentInstant) {
          inputs.set(n, {
            value: stream.latestValue,
            present: true,
          });
        } else {
          inputs.set(n, {
            value: undefined,
            present: false,
          });
        }
      } else {
        assert(false);
      }
    }

    return inputs;
  }

  // Activate a native application, which is to say activate a native definition within the context of a user activation.
  // This will create any necessary streams, "pull" in initial values along any connections to inputs, and set initial
  // values on output streams.
  // No return value.
  _activateNativeApplication(nativeApplication) {
    // Create streams corresponding to the input and output ports of the native function definition,
    //  and store the streams in the containing activation.

    // For inputs we also flow in initial values along connections, if any.
    for (const [n, inPort] of nativeApplication.inPorts) {
      // Create the stream and store it
      const stream = new Stream();
      this.inPortStream.set(inPort, stream);

      // Initialize stream value, flowing in if there is a connection
      if (inPort.connection) {
        this._flowInConnection(inPort.connection);
      }
    }

    const outStreams = []; // We'll use this below
    for (const [n, outPort] of nativeApplication.outPorts) {
      // Create the stream and store it
      const stream = new Stream();
      this.outPortStream.set(outPort, stream);
      outStreams.push(stream);
    }

    // Gather initial inputs from streams
    const initialInputs = this._gatherNativeApplicationInputs(nativeApplication, true);

    // Create onOutputChange callback that sets/flows the changed output streams
    const onOutputChange = (changedOutputs) => {
      for (const [n, v] of changedOutputs) {
        this._setFlowOutPort(nativeApplication.outPorts.get(n), v);
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

  _copyStreamValue(outStream, inStream) {
    // Copy the actual value downstream
    // NOTE: The lastChangedInstant of outStream may not be the current instant,
    // e.g. if this copying is the result of flowing a newly added connection.
    // TODO: ensure that stream's last changed instant is less than current instant?
    inStream.setValue(outStream.latestValue, this.currentInstant);
  }

  _flowInConnection(cxn) {
    // Find the corresponding activation of the output port by walking out a number of activations equal to the connection path length
    let outPortActivation = this;
    for (let i = 0; i < cxn.path.length; i++) {
      outPortActivation = outPortActivation.containingActivation;
    }

    const outStream = outPortActivation.outPortStream.get(cxn.outPort);
    const inStream = this.inPortStream.get(cxn.inPort);
    this._copyStreamValue(outStream, inStream);
  }

  _notifyInPort(inPort, activation) {
    // See what task is associated with notifying inPort, and insert an element
    // into the priority queue, associated with this activation.
    const owner = inPort.owner;
    let priority;
    let task;
    switch (owner.tag) {
      case 'napp':
        const nativeApplication = owner.nativeApplication;
        priority = nativeApplication.sortIndexStr;
        assert(priority !== undefined);
        task = {
          tag: 'napp',
          nativeApplication,
        }
        break;

      default:
        assert(false);
    }

    this.priorityQueue.insert(priority, task);

    // Start pumping if we're not already pumping
    if (!this.pumping) {
      this.pump();
    }
  }

  // Propagate value change along the given connection within the context of the given activation (at the source/out side),
  //  and "notify" any input ports whose values have changed.
  // TODO: We could use this same function to flow an undefined when we disconnect a connection. Could take an optional "value override" parameter
  _flowOutConnectionNotify(cxn) {
    // Since a connection may go into a contained definition, flowing a connection (within the context of a single activation)
    //  may cause the value to "fan out" to multiple activations (or none). So first, we compute the set of relevant activations
    //  on the downstream end of the connection.
    let downstreamActivations = [this];
    for (const def of cxn.path) {
      const nextDownstreamActivations = [];

      for (const act of downstreamActivations) {
        // TODO: for each activation of def (within the context of act), add it to nextDownstreamActivations
      }

      downstreamActivations = nextDownstreamActivations;
    }

    // Now copy the change from the outPort stream to each inPort stream
    const outStream = this.outPortStream.get(cxn.outPort);
    for (const act of downstreamActivations) {
      const inStream = act.inPortStream.get(cxn.inPort);
      this._copyStreamValue(outStream, inStream);
      this._notifyInPort(cxn.inPort, act); // trigger anything "listening" on this port
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
      this._flowOutConnectionNotify(cxn);
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

        default:
          assert(false);
      }
    }

    this.currentInstant++;
  }
}
