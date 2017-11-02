import PriorityQueue from './PriorityQueue';
import Stream from './Stream';

function removeSingle(arr, val) {
  const idx = arr.indexOf(val);
  if (idx < 0) {
    throw new Error('value not in array');
  }
  arr.splice(idx, 1);
  const idx2 = arr.indexOf(val);
  if (idx2 >= 0) {
    throw new Error('value present more than once');
  }
}

function assert(v) {
  if (!v) {
    throw new Error('assertion failed');
  }
}

class OutPort {
  constructor(containingDefinition, tempo) {
    this.containingDefinition = containingDefinition;
    this.tempo = tempo;
    this.connections = new Set();
  }
}

class InPort {
  constructor(containingDefinition, tempo, notifyTask) {
    this.containingDefinition = containingDefinition;
    this.tempo = tempo;
    this.notifyTask = notifyTask;
    this.connection = null;
    // TODO: have a specification of the task to be performed when receiving an update
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
  constructor(definition, updateTask) {
    this.definition = definition;
    this.updateTask = updateTask;
    this.inPorts = new Map(); // name -> InPort
    this.outPorts = new Map(); // name -> OutPort
  }
}

// Definition of a user-defined (not native) function
// containingDefinition is the UserDefinition that contains this one, or null if this is a root-level definition.
// outPort will be null iff containingDefinition is null
class UserDefinition {
  constructor(containingDefinition, outPort) {
    this.containingDefinition = containingDefinition;
    this.outPort = outPort;

    this.definitions = new Set();
    this.nativeApplications = new Set();

    // All activations of this definition (UserActivation instances)
    this.activations = new Set();
  }
}

// Combination of a function definition and a containing activation (outer scope).
//  The containingActivation could be null if the definition is not contained in another definition.
class Closure {
  constructor(definition, containingActivation) {
    this.definition = definition;
    this.containingActivation = containingActivation;
  }
}

// Activation of a user-defined (not native) function. This is the "internal" bookkeeping/state of the activation.
class UserActivation {
  // containingActivation is the activation of our containing lexical scope (definition)
  constructor(containingActivation) {
    this.containingActivation = containingActivation;

    // Maps from OutPort and InPort objects to their corresponding Stream objects for this activation
    this.outPortStream = new Map();
    this.inPortStream = new Map();

    // Map from native applications (within this user-defined function) to their activation wrappers (NativeApplication -> ApplicationWrapper)
    //  We need this so that we can deactivate these activations if we remove the native application.
    this.containedNativeApplicationActivationWrapper = new Map();

    // Map from contained definitions to their activations within the context of this activation (UserDefinition -> Set(UserActivation))
    //  We need this so that we can "flow" changes along connections that go into inner lexical scopes.
    this.containedDefinitionActivation = new Map();
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

export default class NewDynamicRuntime {
  constructor() {
    this.pumping = false; // is there currently a call to pump() running?
    this.priorityQueue = new PriorityQueue(); // this should be empty unless we are pumping
    this.nappSequence = 1; // TODO: remove this hack
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
    const outPort = new OutPort(containingDefinition, 'step'); // this port represents the output of the function-value of the new definition

    const definition = new UserDefinition(containingDefinition, outPort);

    containingDefinition.definitions.add(definition);

    // Update all activations of the containing definition
    for (const containingActivation of containingDefinition.activations) {
      // Make closure with definition and containingActivation
      const closure = new Closure(definition, containingActivation);

      // Make a stream with the closure as value
      const stream = new Stream(closure, this.currentInstant);

      // Store the closure-output stream in the containing activation, associated with the outPort
      containingActivation.outPortStream.set(outPort, stream);

      // NOTE: Since outPort was just created, it can't have any outgoing connections,
      //  so there is no need to flow anything here.

      // Add an entry to the map from contained definitions to their activation sets
      containingActivation.containedDefinitionActivation.set(definition, new Set());
    }

    return definition;
  }

  // Returns a ActivationWrapper
  _activateNativeDefinition(definition, initialInputs, onOutputChange) {
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

  // containingActivation may be null if the definition does not reference any outer scopes.
  // Returns a ActivationWrapper
  _activateUserDefinition(definition, containingActivation, initialInputs, onOutputChange) {
    // TODO: do some sanity checking on arguments:
    // - instanceof checks
    // - if containingActivation is null, is definition.containingDefinition null?
    // - is containingActivation an activation of definition.containingDefinition? UserActivation might need reference to definition for this to work

    const activation = new UserActivation(containingActivation);

    // TODO:
    // - create streams for internal side of function inputs, setting initial values from initialInputs
    // - create streams for contained definitions, setting initial (closure) values (factor this from addContainedUserDefinition?)
    // - in topological sort order, activate native definitions (which will create streams, pulling in initial values if any)
    // - create streams for internal side of function outputs, flow in values
    // - if we have immediate/initial output (check function-output streams), then call onOutputChange

    // Add the new activation to the set of _all_ activations of this definition
    definition.activations.add(activation);

    // Add the new activation to the set of activations of this definition within the given containing activation (if there is a containing activaton)
    if (containingActivation) {
      containingActivation.containedDefinitionActivation.get(definition).add(activation);
    }

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

    const activationWrapper = this._activateNativeDefinition(nativeApplication.definition, initialInputs, onOutputChange);

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
  // If containingActivation is non-null, then it is the containing activation to be used for resolving references to outer scopes.
  // Return value is an ActivationWrapper
  _activateDefinition(definition, containingActivation, initialInputs, onOutputChange) {
    if (definition instanceof UserDefinition) {
      // definition is user-defined
      return this._activateUserDefinition(definition, containingActivation, initialInputs, onOutputChange);
    } else {
      // TODO: Have a class for NativeDefinition so we can instanceof check it here?
      // Definition is native.
      // Since native functions can't have references to outer scopes, we don't need to pass on our containingActivation argument.
      return this._activateNativeDefinition(definition, initialInputs, onOutputChange);
    }
  }

  // Activate a definition (native or user-defined) without any containing scope.
  // A "closed" function is one with no references to outer scopes.
  // An interactive patcher would use this to activate the "main" function definition.
  activateClosedDefinition(definition, initialInputs, onOutputChange) {
    return this._activateDefinition(definition, null, initialInputs, onOutputChange);
  }

  // Activate a closure, which is a native or user-defined function definition paired with a containing scope (activation)
  // This would be used in the implementation of native higher-order functions (e.g. map) to activate their function-value arguments.
  activateClosure(closure, initialInputs, onOutputChange) {
    return this._activateDefinition(closure.definition, closure.containingActivation, initialInputs, onOutputChange);
  }

  addNativeApplication(containingDefinition, definition) {
    assert(!this.pumping);

    assert(containingDefinition instanceof UserDefinition);
    // TODO: verify that definition is in fact a native definition?

    const updateTask = {
      // priority: undefined, // TODO: set this? or does it stay undefined?
      priority: this.nappSequence++, // TODO: unhack and restore previous line
      tag: 'napp',
      nativeApplication: undefined, // NOTE: We set this below after we create the application
    };

    const app = new NativeApplication(definition, updateTask);

    updateTask.nativeApplication = app;

    // Create port objects for the application
    // TODO: In the future, I think these port objects will need to be created on-demand as well (for variable positional arguments)
    for (const n in definition.inputs) {
      app.inPorts.set(n, new InPort(containingDefinition, definition.inputs[n].tempo, updateTask));
    }
    for (const n in definition.outputs) {
      app.outPorts.set(n, new OutPort(containingDefinition, definition.outputs[n].tempo));
    }

    containingDefinition.nativeApplications.add(app);

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
    const task = inPort.notifyTask;
    const priority = task.priority;
    assert(priority !== undefined);

    this.priorityQueue.insert(priority, {
      task,
      activation,
    });

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

  _priorityQueueElemsEqual(a, b) {
    // NOTE: I'm pretty sure it's safe to compare object idenity of tasks here
    return (a.task === b.task) && (a.activation === b.activation);
  }

  pump() {
    const pq = this.priorityQueue;
    const instant = this.currentInstant;

    while (!pq.isEmpty()) {
      const elem = pq.pop();

      // Keep popping and discarding as long as next element is a duplicate
      while (!pq.isEmpty() && this._priorityQueueElemsEqual(pq.peek(), elem)) {
        pq.pop();
      }

      const {task, activation} = elem;

      switch (task.tag) {
        case 'napp':
          const nativeApp = task.nativeApplication;
          const activationWrapper = activation.containedNativeApplicationActivationWrapper.get(nativeApp);
          const inputs = this._gatherNativeApplicationInputs(nativeApp, activation, false);
          activationWrapper.update(inputs);
          break;

        default:
          assert(false);
      }
    }

    this.currentInstant++;
  }
}

class DynamicRuntime {
  constructor() {
    this.nodeMap = new Map(); // maps nodeId -> instance record
    this.nextNodeId = 1;

    this.cxnMap = new Map(); // maps cxnId -> connection record
    this.nextCxnId = 1;

    this.pumping = false; // is there currently a call to pump() running?
    this.priorityQueue = new PriorityQueue(); // this should be empty unless we are pumping

    this.currentInstant = 1; // before pump this is next instant, during pump it's current instant
  }

  addNode(nodeDef) {
    const nid = this.nextNodeId;
    this.nextNodeId++;

    // Create inputs map
    const inputs = {}; // map port name to record
    for (const k in nodeDef.inputs) {
      inputs[k] = {
        cxn: null,
        stream: new Stream(),
      }
      inputs[k].stream.lastChangedInstant = this.currentInstant;
    }

    // Create output streams and cxn lists
    const outputs = {}; // maps port name to record
    for (const k in nodeDef.outputs) {
      outputs[k] = {
        cxns: [],
        stream: new Stream(),
      };
    }

    // TODO: can we do this without a closure?
    const setOutputs = (changedOutputs) => {
      const pq = this.priorityQueue;

      // For each changed output, save to stream and insert PQ tasks for downstream ports
      for (const outPort in changedOutputs) {
        // TODO: I think we can do a sanity check here: if the lastChangedInstant of this
        //  stream is the current instant, then we are in some kind of cycle or a node
        //  has misbehaved and output more than once
        outputs[outPort].stream.setValue(changedOutputs[outPort], this.currentInstant);

        // Insert PQ tasks for downstream nodes
        for (const cid of outputs[outPort].cxns) {
          const cxn = this.cxnMap.get(cid);
          const downstreamNodeId = cxn.toNodeId;
          this.insertNodeTask(downstreamNodeId);
        }
      }

      if (!this.pumping) {
        this.pump();
      }
    };

    // Build context object
    const context = {
      setOutputs,
      state: null,
      // TODO: can we define setState without a closure?
      setState: (newState) => {
        // TODO: Do we want to immediately reflect state update to nodes? Perhaps there is no harm
        context.state = newState;
      },
      transient: null,
    };

    // Instantiate node if it has a create method
    // NOTE: This doesn't actually return anything, create() calls
    //  functions in context to set outputs, store state, etc.
    if (nodeDef.create) {
      nodeDef.create(context);
    }

    // Make record in map
    this.nodeMap.set(nid, {
      nodeDef,
      context,
      inputs,
      outputs,
      // toposortIndex: null, // since not connected, no index
      toposortIndex: nid, // TODO: unhack (restore line above) when we have toposort
    });

    return nid;
  }

  removeNode(nodeId) {
    const node = this.nodeMap.get(nodeId);

    // Remove any connections involving this node
    for (const p in node.inputs) {
      if (node.inputs[p].cxn) {
        this.internalRemoveConnection(node.inputs[p].cxn, nodeId);
      }
    }
    for (const p in node.outputs) {
      for (const cid of node.outputs[p].cxns) {
        this.internalRemoveConnection(cid, nodeId);
      }
    }

    // Call destroy function, if present
    if (node.nodeDef.destroy) {
      node.nodeDef.destroy(node.context);
    }

    // Remove the node from map
    this.nodeMap.delete(nodeId);

    // Do any necessary updating
    this.pump();
  }

  disconnectPort(nodeId, isInput, port) {
    const node = this.nodeMap.get(nodeId);

    if (isInput) {
      if (node.inputs[port].cxn) {
        this.internalRemoveConnection(node.inputs[port].cxn);
      }
    } else {
      for (const cid of node.outputs[port].cxns) {
        this.internalRemoveConnection(cid);
      }
    }

    // Do any necessary updating
    this.pump();
  }

  addConnection(fromNodeId, fromPort, toNodeId, toPort) {
    const cid = this.nextCxnId;
    this.nextCxnId++;

    // TODO: we could sanity check node ids and port names

    const fromNode = this.nodeMap.get(fromNodeId);
    const toNode = this.nodeMap.get(toNodeId);

    if (toNode.inputs[toPort].cxn) {
      throw new Error('input port already has a connection');
    }

    fromNode.outputs[fromPort].cxns.push(cid);
    toNode.inputs[toPort].cxn = cid;
    toNode.inputs[toPort].stream = fromNode.outputs[fromPort].stream;

    this.cxnMap.set(cid, {
      fromNodeId,
      fromPort,
      toNodeId,
      toPort,
    });

    if (!this.updateToposort()) {
      // Sort failed, so need to roll back addition
      // TODO: implement
      throw new Error('sort failed');
    }

    // Update downstream node unless stream is event
    if (fromNode.nodeDef.outputs[fromPort].tempo !== 'event') {
      this.insertNodeTask(toNodeId);
      this.pump();
    }

    return cid;
  }

  clear() {
    // Destroy all nodes (many require cleanup)
    for (const [nid, node] of this.nodeMap) {
      if (node.nodeDef.destroy) {
        node.nodeDef.destroy(node.context);
      }
    }

    this.nodeMap.clear();
    this.cxnMap.clear();
    this.pumping = false;
    this.priorityQueue.clear();
  }

  internalRemoveConnection(cxnId, dontUpdateNodeId) {
    const cxn = this.cxnMap.get(cxnId);

    const fromNode = this.nodeMap.get(cxn.fromNodeId);
    const toNode = this.nodeMap.get(cxn.toNodeId);

    removeSingle(fromNode.outputs[cxn.fromPort].cxns, cxnId);

    toNode.inputs[cxn.toPort].cxn = null;
    const stream = new Stream();
    stream.lastChangedInstant = this.currentInstant;
    toNode.inputs[cxn.toPort].stream = stream;

    if (cxn.toNodeId !== dontUpdateNodeId) {
      this.insertNodeTask(cxn.toNodeId);
    }

    this.cxnMap.delete(cxnId);
  }

  removeConnection(cxnId) {
    this.internalRemoveConnection(cxnId);
    this.pump();
  }

  updateToposort() {
    // TODO: implement
    return true;
  }

  insertNodeTask(nodeId) {
    const priority = this.nodeMap.get(nodeId).toposortIndex;
    this.priorityQueue.insert(priority, nodeId);
  }

  pump() {
    const pq = this.priorityQueue;
    const instant = this.currentInstant;

    if (pq.isEmpty()) {
      // Shortcut to not increment instant count
      return;
    }

    while (!pq.isEmpty()) {
      const nid = pq.pop();

      // Keep popping and discarding as long as next task is for same node id (there may be duplicates)
      while (!pq.isEmpty() && (pq.peek() === nid)) {
        pq.pop();
      }

      // Do update for given node
      const nodeRec = this.nodeMap.get(nid);
      const inputs = {};
      for (const k in nodeRec.nodeDef.inputs) {
        const inputStream = nodeRec.inputs[k].stream;
        const changed = inputStream.lastChangedInstant === instant;

        if (nodeRec.nodeDef.inputs[k].tempo === 'event') {
          inputs[k] = {
            value: changed ? inputStream.latestValue : undefined, // don't expose old event data
            present: changed,
          };
        } else {
          inputs[k] = {
            value: inputStream.latestValue,
            changed,
          };
        }
      }
      if (!nodeRec.nodeDef.update) {
        throw new Error('node has inputs but no update function');
      }
      nodeRec.nodeDef.update(nodeRec.context, inputs);
    }

    this.currentInstant++;
  }
}
