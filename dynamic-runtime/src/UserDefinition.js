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
  constructor(containingDefinition, name, tempo, owner) {
    this.containingDefinition = containingDefinition;
    this.name = name;
    this.tempo = tempo;
    this.owner = owner;
    this.connection = null;
  }
}

// Within a UserDefinition, this represents the application of a native function
class NativeApplication {
  constructor(definition, functionArguments, settings) {
    this.definition = definition;
    this.functionArguments = functionArguments; // NOTE: these are unchangeable for now
    this.settings = settings;

    this.sortIndex = undefined;
    this.inputs = []; // array of InPort
    this.output = null; // either an OutPort or a Map from string to OutPort
  }
}

// Definition of a user-defined (not native) function
// containingDefinition is the UserDefinition that contains this one, or null if this is a root-level definition.
export default class UserDefinition {
  constructor(containingDefinition, signature) {
    this.containingDefinition = containingDefinition;

    this.containedDefinitions = new Set();
    this.definitionToUsingApplications = new Map(); // map from UserDefinition (in this or outer scope) to the Set of local NativeApplications that make use of it (take it as a "function argument")
    this.nativeApplications = new Set(); // These are kept in topological sort order

    this.definitionInputs = []; // array of OutPort
    this.definitionOutputs = null; // either InPort or Map from name to InPort or null

    if (signature) {
      for (const inp of signature.inputs) {
        this.definitionInputs.push(new OutPort(this, inp.tempo));
      }
      const inPortsOwner = {
        tag: 'def',
        definition: this,
      };
      if (signature.output) {
        assert(!signature.outputs);
        this.definitionOutput = new InPort(this, null, signature.output.tempo, inPortsOwner);
      } else if (signature.outputs) {
        this.definitionOutput = new Map();
        for (const n in signature.outputs) {
          this.definitionOutput.set(n, new InPort(this, n, signature.outputs[n].tempo, inPortsOwner));
        }
      }
    }

    this.connections = new Set(); // All connections whose out port is in this definition

    // All activations of this definition (UserActivation instances)
    this.activations = new Set();
  }

  // Create a new (initially empty) user-defined function definition, contained within this definition.
  addContainedUserDefinition(signature) {
    const definition = new UserDefinition(this, signature);

    this.containedDefinitions.add(definition);
    this.definitionToUsingApplications.set(definition, new Set());

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

    const app = new NativeApplication(definition, functionArguments, definition.defaultSettings);

    // Create port objects for the application
    // TODO: In the future, I think these port objects will need to be created on-demand as well (for variable positional arguments)
    const inPortsOwner = {
      tag: 'napp',
      nativeApplication: app,
    };
    for (const inp of definition.inputs) {
      app.inputs.push(new InPort(this, inp.name, inp.tempo, inPortsOwner));
    }
    if (definition.output) {
      assert(!definition.outputs);
      app.output = new OutPort(this, definition.output.tempo);
    } else if (definition.outputs) {
      app.output = new Map();
      for (const n in definition.outputs) {
        app.output.set(n, new OutPort(this, definition.outputs[n].tempo));
      }
    }

    this.nativeApplications.add(app);

    // Track function arguments used by this application so that we may send in values from outer
    // scopes if needed.
    for (const def of functionArguments.values()) {
      if (def) {
        this.definitionToUsingApplications.get(def).add(app);
      }
    }

    // Update topological sort
    // NOTE: While the sort shouldn't really have changed, we want to make sure that all
    // applications have valid sort indexes. We could also just assign this new application
    // a valid sort index (e.g. one higher than current highest) but this is easy/clear.
    this._updateTopologicalSort();

    // Let all activations of this definition know that a native application was added
    for (const act of this.activations) {
      act.addedNativeApplication(app);
    }

    return app;
  }

  setApplicationSettings(nativeApplication, newSettings) {
    assert(this.nativeApplications.has(nativeApplication));

    // Let all activations of this definition know that this application's settings have changed
    for (const act of this.activations) {
      act.setApplicationSettings(nativeApplication, newSettings);
    }

    this.recursiveActivationsUpdate();
  }

  activate(initialInputs, onOutputChange, functionArguments) {
    const activation = new UserActivation(this, initialInputs, onOutputChange, functionArguments);

    // Add the new activation to the set of _all_ activations of this definition
    this.activations.add(activation);

    return activation;
  }

  // Notify this definition that one of its activations has been deactivated
  activationDeactivated(activation) {
    this.activations.delete(activation);
  }

  // This is called when something about this definition has changed that will require its
  // activations (and potentially all its "parent" activations) to have update() called on them.
  recursiveActivationsUpdate() {
    // Compute the "path" of definitions to this one
    const definitionPath = [];
    for (let def = this; def; def = def.containingDefinition) {
      definitionPath.push(def);
    }
    definitionPath.reverse();

    const rootDef = definitionPath[0];

    for (const rootAct of rootDef.activations) {
      rootAct.definitionChanged(definitionPath.slice(1));
    }
  }

  // Return a generator that iterates over all connections contained within this definition
  // or any contained definitions (recursively)
  * deepConnections() {
    for (const cxn of this.connections) {
      yield cxn;
    }

    for (const def of this.containedDefinitions) {
      yield* def.deepConnections();
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

    // outPort must be in this definition
    assert(outPort.containingDefinition === this);

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
    this._updateTopologicalSort();

    // Let all activations of this definition know that a connection was added
    for (const act of this.activations) {
      act.addedConnection(cxn);
    }

    this.recursiveActivationsUpdate();
  }

  _topologicalSortTraverseFromOutPort(outPort, traversingNapps, finishedNapps, reverseResult) {
    for (const cxn of outPort.connections) {
      if (cxn.path.length > 0) {
        // Connection has a non-empty path, which means that it goes into a sub-definition.
        // We identify the (outermost) sub-definition that the connection enters, and traverse
        // to any applications that make use of it.
        const outermostSubdef = cxn.path[0];
        for (const napp of this.definitionToUsingApplications.get(outermostSubdef)) {
          this._topologicalSortTraverseFromNapp(traversingNapps, finishedNapps, reverseResult);
        }
      } else {
        // Connection has empty path, which means that it goes to another port in this same scope
        const inPortOwner = cxn.inPort.owner;
        switch (inPortOwner.tag) {
          case 'napp':
            // Traverse from each native application at downstream end of this cxn
            this._topologicalSortTraverseFromNapp(inPortOwner.nativeApplication, traversingNapps, finishedNapps, reverseResult);
            break;

          case 'def':
            // I think we don't need to do anything here
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
    if (nativeApplication.output instanceof Map) {
      // Compound output
      for (const [n, outPort] of nativeApplication.output) {
        this._topologicalSortTraverseFromOutPort(outPort, traversingNapps, finishedNapps, reverseResult);
      }
    } else if (nativeApplication.output) {
      // Single output
      this._topologicalSortTraverseFromOutPort(nativeApplication.output, traversingNapps, finishedNapps, reverseResult);
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

    // Given result, reorder set, assign indexes
    const reorderedNativeApplications = new Set();
    for (let i = reverseResult.length - 1, sortIndex = 0; i >= 0; i--, sortIndex++) {
      const napp = reverseResult[i];

      reorderedNativeApplications.add(napp);

      // Store the sort index
      napp.sortIndex = sortIndex;
    }

    // Replace our native application set with our new, reordered one.
    // Sanity check that the sets have the same elements
    assert(setsEqual(reorderedNativeApplications, this.nativeApplications));
    this.nativeApplications = reorderedNativeApplications;
  }
}
