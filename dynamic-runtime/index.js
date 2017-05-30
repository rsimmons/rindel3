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

export default class DynamicRuntime {
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
