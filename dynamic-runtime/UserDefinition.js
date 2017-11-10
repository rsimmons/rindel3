import assert from './assert';
import UserActivation from './UserActivation';

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

class Connection {
  constructor(outPort, inPort, path) {
    this.outPort = outPort;
    this.inPort = inPort;
    this.path = path;
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
  constructor(containingDefinition, tempo, owner) {
    this.containingDefinition = containingDefinition;
    this.tempo = tempo;
    this.owner = owner;
    this.connection = null;
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
export default class UserDefinition {
  constructor(containingDefinition) {
    this.containingDefinition = containingDefinition;

    this.containedDefinitions = new Set();
    this.definitionUsedByApplications = new Map(); // map from UserDefinition (in this or outer scope) to the Set of local NativeApplications that make use of it (take it as a "function argument")
    this.nativeApplications = new Set(); // These are kept in topological sort order

    this.connections = new Set(); // All connections whose out port is in this definition

    // All activations of this definition (UserActivation instances)
    this.activations = new Set();
  }

  // Create a new (initially empty) user-defined function definition, contained within the given containingDefinition.
  addContainedUserDefinition(containingDefinition) {
    const definition = new UserDefinition(containingDefinition);

    containingDefinition.containedDefinitions.add(definition);
    containingDefinition.definitionUsedByApplications.set(definition, new Set());

    return definition;
  }

  addNativeApplication(definition, functionArguments) {
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
      app.inPorts.set(n, new InPort(this, definition.inputs[n].tempo, inPortsOwner));
    }
    for (const n in definition.outputs) {
      app.outPorts.set(n, new OutPort(this, definition.outputs[n].tempo));
    }

    this.nativeApplications.add(app);

    // Track function arguments used by this application so that we may send in values from outer
    // scopes if needed.
    for (const def of functionArguments.values()) {
      if (def) {
        this.definitionUsedByApplications.get(def).add(app);
      }
    }

    // For each current activation of the containing definition, make an activation of this new native application
    for (const act of this.activations) {
      assert(!act.pumping); // TODO: adjust this check to use some sort of public method

      act._activateNativeApplication(app);

      // TODO: Might we need to pump? Not sure if it's necessary. For now, assert that there is nothing to be pumped.
      assert(act.priorityQueue.isEmpty());
    }


    return app;
  }

  activate(initialInputs, onOutputChange, functionArguments) {
    const activation = new UserActivation(this, initialInputs, onOutputChange, functionArguments);

    // Add the new activation to the set of _all_ activations of this definition
    this.activations.add(activation);

    return activation;
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
        act._flowConnection(cxn);
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

  _updateTopologicalSort() {
    const traversingNapps = new Set();
    const finishedNapps = new Set();
    const reverseResult = [];

    for (const napp of this.nativeApplications) {
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

    // Replace our native application set with our new, reordered one.
    // Sanity check that the sets have the same elements
    assert(setsEqual(reorderedNativeApplications, this.nativeApplications));
    this.nativeApplications = reorderedNativeApplications;
  }
}

