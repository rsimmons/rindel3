import PriorityQueue from './PriorityQueue';
import Stream from './Stream';

function assert(v) {
  if (!v) {
    throw new Error('assertion failed');
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }

  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }

  return true;
}

class OutPort {
  constructor(containingDefinition, tempo) {
    this.containingDefinition = containingDefinition;
    this.tempo = tempo;
    this.connections = new Set();
  }
}

class InPort {
  constructor(containingDefinition, tempo, owner) {
    this.containingDefinition = containingDefinition;
    this.tempo = tempo;
    this.owner = owner;
    this.connection = null;
  }
}

class Connection {
  constructor(outPort, inPort, path) {
    this.outPort = outPort;
    this.inPort = inPort;
    this.path = path;
  }
}

// Within a UserDefinition, this represents the application of a native function
class NativeApplication {
  constructor(definition, functionArguments) {
    this.definition = definition;
    this.functionArguments = functionArguments; // NOTE: these are unchangeable for now
    this.sortIndexStr = undefined;
    this.inPorts = new Map(); // name -> InPort
    this.outPorts = new Map(); // name -> OutPort
  }
}

// Definition of a user-defined (not native) function
// containingDefinition is the UserDefinition that contains this one, or null if this is a root-level definition.
class UserDefinition {
  constructor(containingDefinition) {
    this.containingDefinition = containingDefinition;

    this.containedDefinitions = new Set();
    this.definitionUsedByApplications = new Map(); // map from UserDefinition (in this or outer scope) to the Set of local NativeApplications that make use of it (take it as a "function argument")
    this.nativeApplications = new Set(); // These are kept in topological sort order

    // All activations of this definition (UserActivation instances)
    this.activations = new Set();
  }
}

// Activation of a user-defined (not native) function. This is the "internal" bookkeeping/state of the activation.
class UserActivation {
  constructor(containingActivation) {
    // Maps from OutPort and InPort objects to their corresponding Stream objects for this activation
    this.outPortStream = new Map();
    this.inPortStream = new Map();

    // Map from native applications (within this user-defined function) to their activation wrappers (NativeApplication -> ApplicationWrapper)
    //  We need this so that we can deactivate these activations if we remove the native application.
    this.containedNativeApplicationActivationWrapper = new Map();
  }
}

// This provides an inteface to control the activation of either a native or user-defined function,
//  letting the holder push in new inputs and deactivate it.
//  update(inputs): takes a Map from port name to StreamInput
//  destroy(): deactivates the activation, freeing up any resources and ensuring that no further output callbacks are made
class ActivationWrapper {
  constructor(onUpdate, onDestroy) {
    // We directly assign these callbacks to properties. There's no need to bind them since they don't need to access "this".
    this.update = onUpdate;
    this.destroy = onDestroy;
  }
}

export default class DynamicRuntime {
  constructor() {
    this.pumping = false; // is there currently a call to pump() running?
    this.priorityQueue = new PriorityQueue(); // this should be empty unless we are pumping
    this.currentInstant = 1; // before pump this is next instant, during pump it's current instant

    this.rootDefinitions = new Set(); // function definitions not contained by others

    this.connections = new Set(); // all connections, since they can cross definitions so not owned by definitions
  }

  // Create a new (initially empty) user-defined function definition at the root level (not contained within another definition)
  addRootUserDefinition() {
    const definition = new UserDefinition(null, null);

    this.rootDefinitions.add(definition);

    return definition;
  }

  // Create a new (initially empty) user-defined function definition, contained within the given containingDefinition.
  addContainedUserDefinition(containingDefinition) {
    const definition = new UserDefinition(containingDefinition);

    containingDefinition.containedDefinitions.add(definition);
    containingDefinition.definitionUsedByApplications.set(definition, new Set());

    return definition;
  }

  // Returns a ActivationWrapper
  _activateNativeDefinition(definition, functionArguments, initialInputs, onOutputChange) {
    // TODO: verify that definition is a native definition?

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

    const onUpdate = (inputs) => {
      // Massage inputs into the right structure
      const convertedInputs = {};
      for (const k in definition.inputs) {
        assert(inputs.has(k));
        convertedInputs[k] = inputs.get(k);
      }

      definition.update(context, convertedInputs);
    };

    const onDestroy = () => {
      // Call underlying destroy function, if present
      if (definition.destroy) {
       definition.destroy(context);
      }
    };

    return new ActivationWrapper(onUpdate, onDestroy);
  }

  // Returns a ActivationWrapper
  _activateUserDefinition(definition, initialInputs, onOutputChange) {
    // TODO: do some sanity checking on arguments:
    // - instanceof checks

    const activation = new UserActivation();

    // TODO: create streams for internal side of function inputs, setting initial values from initialInputs

    // Activate native applications (which will create streams, pulling in initial values if any).
    // This needs to be done in topological sort order, but we keep them ordered so it's easy. 
    for (const napp of definition.nativeApplications) {
      this._activateNativeApplication(napp, activation);
    }

    // TODO: create streams for internal side of function outputs, flow in values
    // TODO: if we have immediate/initial output (check function-output streams), then call onOutputChange

    // Add the new activation to the set of _all_ activations of this definition
    definition.activations.add(activation);

    // TODO: create, set up and return an ActivationWrapper that interfaces with the activation
    // - update method will do _setFlowOutPort on corresponding input ports
    // - destroy method will deactivate
  }

  _gatherNativeApplicationInputs(nativeApplication, containingActivation, initial) {
    const inputs = new Map();

    for (const [n, inPort] of nativeApplication.inPorts) {
      const stream = containingActivation.inPortStream.get(inPort);

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
  _activateNativeApplication(nativeApplication, containingActivation) {
    assert(nativeApplication instanceof NativeApplication);
    assert(containingActivation instanceof UserActivation);

    // Create streams corresponding to the input and output ports of the native function definition,
    //  and store the streams in the containing activation.

    // For inputs we also flow in initial values along connections, if any.
    for (const [n, inPort] of nativeApplication.inPorts) {
      // Create the stream and store it
      const stream = new Stream();
      containingActivation.inPortStream.set(inPort, stream);

      // Initialize stream value, flowing in if there is a connection
      if (inPort.connection) {
        this._flowInConnection(inPort.connection, containingActivation);
      }
    }

    const outStreams = []; // We'll use this below
    for (const [n, outPort] of nativeApplication.outPorts) {
      // Create the stream and store it
      const stream = new Stream();
      containingActivation.outPortStream.set(outPort, stream);
      outStreams.push(stream);
    }

    // Gather initial inputs from streams
    const initialInputs = this._gatherNativeApplicationInputs(nativeApplication, containingActivation, true);

    // Create onOutputChange callback that sets/flows the changed output streams
    const onOutputChange = (changedOutputs) => {
      for (const [n, v] of changedOutputs) {
        this._setFlowOutPort(nativeApplication.outPorts.get(n), containingActivation, v);
      }
    };

    const activationWrapper = this._activateNativeDefinition(nativeApplication.definition, nativeApplication.functionArguments, initialInputs, onOutputChange);

    // If lastChangedInstant is still undefined on any output streams, set it to current instant
    for (const stream of outStreams) {
      if (stream.lastChangedInstant === undefined) {
        stream.lastChangedInstant = this.currentInstant;
      }
    }

    // Store the new activation in the containing activation
    containingActivation.containedNativeApplicationActivationWrapper.set(nativeApplication, activationWrapper);
  }

  // Activate the given definition (native or user-defined).
  // Return value is an ActivationWrapper
  _activateDefinition(definition, functionArguments, initialInputs, onOutputChange) {
    if (definition instanceof UserDefinition) {
      // definition is user-defined
      return this._activateUserDefinition(definition, initialInputs, onOutputChange);
    } else {
      // TODO: Have a class for NativeDefinition so we can instanceof check it here?
      // Definition is native.
      // Since native functions can't have references to outer scopes, we don't need to pass on our containingActivation argument.
      return this._activateNativeDefinition(definition, functionArguments, initialInputs, onOutputChange);
    }
  }

  // Activate a definition (native or user-defined) without any containing scope.
  // A "closed" function is one with no references to outer scopes.
  // An interactive patcher would use this to activate the "main" function definition.
  activateClosedDefinition(definition, initialInputs, onOutputChange) {
    return this._activateDefinition(definition, new Map(), initialInputs, onOutputChange);
  }

  addNativeApplication(containingDefinition, definition, functionArguments) {
    assert(!this.pumping);

    assert(containingDefinition instanceof UserDefinition);
    // TODO: verify that definition is in fact a native definition?

    // Validate functionArguments parameter
    for (const [n, def] of functionArguments) {
      assert(n in definition.functionParameters); // can only provide args matching parameters
      if (def !== undefined) {
        // TODO: assert that def is either native or a user definition with a common parent
      }
    }

    const app = new NativeApplication(definition, functionArguments);

    // Create port objects for the application
    // TODO: In the future, I think these port objects will need to be created on-demand as well (for variable positional arguments)
    const inPortsOwner = {
      tag: 'napp',
      nativeApplication: app,
    };
    for (const n in definition.inputs) {
      app.inPorts.set(n, new InPort(containingDefinition, definition.inputs[n].tempo, inPortsOwner));
    }
    for (const n in definition.outputs) {
      app.outPorts.set(n, new OutPort(containingDefinition, definition.outputs[n].tempo));
    }

    containingDefinition.nativeApplications.add(app);

    // Track function arguments used by this application so that we may send in values from outer
    // scopes if needed.
    for (const def of functionArguments.values()) {
      if (def) {
        containingDefinition.definitionUsedByApplications.get(def).add(app);
      }
    }

    // For each current activation of the containing definition, make an activation of this new native application
    for (const containingActivation of containingDefinition.activations) {
      this._activateNativeApplication(app, containingActivation);
    }

    // TODO: Might we need to pump? Not sure if it's necessary. For now, assert that there is nothing to be pumped.
    assert(this.priorityQueue.isEmpty());

    return app;
  }

  _copyStreamValue(outStream, inStream) {
    // Copy the actual value downstream
    // NOTE: The lastChangedInstant of outStream may not be the current instant,
    // e.g. if this copying is the result of flowing a newly added connection.
    // TODO: ensure that stream's last changed instant is less than current instant?
    inStream.setValue(outStream.latestValue, this.currentInstant);
  }

  _flowInConnection(cxn, inPortActivation) {
    // Find the corresponding activation of the output port by walking out a number of activations equal to the connection path length
    let outPortActivation = inPortActivation;
    for (let i = 0; i < cxn.path.length; i++) {
      outPortActivation = outPortActivation.containingActivation;
    }

    const outStream = outPortActivation.outPortStream.get(cxn.outPort);
    const inStream = inPortActivation.inPortStream.get(cxn.inPort);
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
          activation,
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
  _flowOutConnectionNotify(cxn, outPortActivation) {
    // Since a connection may go into a contained definition, flowing a connection (within the context of a single activation)
    //  may cause the value to "fan out" to multiple activations (or none). So first, we compute the set of relevant activations
    //  on the downstream end of the connection.
    let downstreamActivations = [outPortActivation];
    for (const def of cxn.path) {
      const nextDownstreamActivations = [];

      for (const act of downstreamActivations) {
        // TODO: for each activation of def (within the context of act), add it to nextDownstreamActivations
      }

      downstreamActivations = nextDownstreamActivations;
    }

    // Now copy the change from the outPort stream to each inPort stream
    const outStream = outPortActivation.outPortStream.get(cxn.outPort);
    for (const act of downstreamActivations) {
      const inStream = act.inPortStream.get(cxn.inPort);
      this._copyStreamValue(outStream, inStream);
      this._notifyInPort(cxn.inPort, act); // trigger anything "listening" on this port
    }
  }

  // Set the value of the given outPort in the context of activation (which corresponds to a specific stream),
  //  and flow the change along any outgoing connections.
  // NOTE: We take a OutPort+UserActivation rather than Stream because we need the OutPort to find connections.
  _setFlowOutPort(outPort, activation, value) {
    // Set the stream value
    const outStream = activation.outPortStream.get(outPort);
    // TODO: ensure that stream's last changed instant is less than current instant?
    outStream.setValue(value, this.currentInstant);

    // Flow the change
    for (const cxn of outPort.connections) {
      this._flowOutConnectionNotify(cxn, activation);
    }
  }

  // Figure out the series of nested definitions that we need to enter to get from outPort to inPort.
  //  Return an array of definition objects. If outPort and inPort are in same scope, then the array
  //  will be empty.
  //  If there is no path, then return null.
  _computeDefinitionPath(outPort, inPort) {
    // Shortcut the common case
    if (outPort.containingDefinition === inPort.containingDefinition) {
      return [];
    }

    // TODO: implement. need to do lowest common ancestor of definition tree, I think. look at the containingDefinition of ports
    throw new Error('unimplemented');
  }

  // NOTE: This returns a path if valid, otherwise returns null
  _validateConnection(outPort, inPort) {
    assert(outPort instanceof OutPort);
    assert(inPort instanceof InPort);

    // inPort can't already have a connection
    if (inPort.connection) {
      return null;
    }

    // Ports must have the same tempo
    if (outPort.tempo !== inPort.tempo) {
      return null;
    }

    const path = this._computeDefinitionPath(outPort, inPort);
    if (!path) {
      // If there's no path, then the connection is invalid (doesn't connect within same scope or to inner scope)
      return null;
    }

    // TODO: add further checks

    return path;
  }

  isValidConnection(outPort, inPort) {
    return !!_validateConnection(outPort, inPort);
  }

  addConnection(outPort, inPort) {
    assert(!this.pumping);

    // Validate connection (which finds its definition path as a side effect)
    const v = this._validateConnection(outPort, inPort);
    if (!v) {
      throw new Error('invalid connection, caller should check first');
    }
    const path = v;

    const cxn = new Connection(outPort, inPort, path);

    outPort.connections.add(cxn);
    inPort.connection = cxn;
    this.connections.add(cxn);

    // Update topological sort
    // NOTE: We could probably only do a partial/incremental update, but this is easy for now
    this._updateTopologicalSort();

    // If this connection is between step-tempo ports, then "flow" the connection
    // for all activations of the definition containing outPort.
    // NOTE: I think it should be safe to flow the connection even the ports are event-tempo,
    // but it is just unnecessary so this check is an optimization.
    if (outPort.tempo === 'step') {
      for (const act of outPort.containingDefinition.activations) {
        this._flowOutConnectionNotify(cxn, act);
      }
    }
  }

  _topologicalSortTraverseFromOutPort(outPort, traversingNapps, finishedNapps, reverseResult) {
    for (const cxn of outPort.connections) {
      if (cxn.path.length > 0) {
        // Connection has a non-empty path, which means that it goes into a sub-definition
        // We identify the (outermost) sub-definition that the connection enters, and traverse
        // out from its function-value outPort.
        this._topologicalSortTraverseFromOutPort(cxn.path[0].outPort, traversingNapps, finishedNapps, reverseResult);
      } else {
        // Connection has empty path, which means that it goes to another port in this same scope
        const inPortOwner = cxn.inPort.owner;
        switch (inPortOwner.tag) {
          case 'napp':
            // Traverse from each native application at downstream end of this cxn
            this._topologicalSortTraverseFromNapp(inPortOwner.nativeApplication, traversingNapps, finishedNapps, reverseResult);
            break;

          default:
            assert(false);
        }
      }
    }
  }

  _topologicalSortTraverseFromNapp(nativeApplication, traversingNapps, finishedNapps, reverseResult) {
    if (finishedNapps.has(nativeApplication)) {
      return;
    }

    if (traversingNapps.has(nativeApplication)) {
      // TODO: handle this differently
      throw new Error('topological sort encountered a cycle');
    }

    traversingNapps.add(nativeApplication);

    // Traverse from each output port of this native application
    for (const [n, outPort] of nativeApplication.outPorts) {
      this._topologicalSortTraverseFromOutPort(outPort, traversingNapps, finishedNapps, reverseResult);
    }

    traversingNapps.delete(nativeApplication);
    finishedNapps.add(nativeApplication);

    // Append nativeApplication to final result list (which is in reverse order)
    reverseResult.push(nativeApplication);
  }

  _updateTopologicalSortForUserDefinition(definition) {
    const traversingNapps = new Set();
    const finishedNapps = new Set();
    const reverseResult = [];

    for (const napp of definition.nativeApplications) {
      this._topologicalSortTraverseFromNapp(napp, traversingNapps, finishedNapps, reverseResult);
    }

    // Given result, assign priorities

    // Figure out how long our zero-padded sort index strings need to be
    const paddedLength = (reverseResult.length - 1).toString().length;

    const reorderedNativeApplications = new Set();
    for (let i = reverseResult.length - 1, n = 0; i >= 0; i--, n++) {
      const napp = reverseResult[i];

      reorderedNativeApplications.add(napp);

      // Create sort index string, a zero-padded integer string, so that it will lexicographically sort
      let sortIndexStr = n.toString();
      while (sortIndexStr.length < paddedLength) {
        sortIndexStr = '0' + sortIndexStr;
      }

      // Store the sort index string
      napp.sortIndexStr = sortIndexStr;
    }

    // Replace the definition's native applications set with our new, reordered one.
    // Sanity check that the sets have the same elements
    assert(setsEqual(reorderedNativeApplications, definition.nativeApplications));
    definition.nativeApplications = reorderedNativeApplications;

    // Make recursive call to update each contained definition
    for (const containedDef of definition.containedDefinitions) {
      this._updateTopologicalSortForUserDefinition(containedDef);
    }
  }

  _updateTopologicalSort() {
    for (const rootDef of this.rootDefinitions) {
      this._updateTopologicalSortForUserDefinition(rootDef);
    }
  }

  _priorityQueueTasksEqual(a, b) {
    if (a.tag !== b.tag) {
      return false;
    }

    switch (a.tag) {
      case 'napp':
        return (a.nativeApplication === b.nativeApplication) && (a.activation === b.activation);

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
          const {nativeApplication, activation} = task;
          const activationWrapper = activation.containedNativeApplicationActivationWrapper.get(nativeApplication);
          const inputs = this._gatherNativeApplicationInputs(nativeApplication, activation, false);
          activationWrapper.update(inputs);
          break;

        default:
          assert(false);
      }
    }

    this.currentInstant++;
  }
}
