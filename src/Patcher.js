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

export default class Patcher {
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

    // Create input cxns map
    const inputCxns = {}; // maps port name to cxn id or null
    const inputStreams = {}; // maps port name to object with input stream value
    for (const k in nodeDef.inputs) {
      inputCxns[k] = null;
      inputStreams[k] = new Stream();
    }

    // Create output streams and cxn lists
    const outputCxns = {}; // maps port name to array of cxn ids
    const outputStreams = {}; // maps port name to stream object
    for (const k in nodeDef.outputs) {
      outputCxns[k] = [];
      outputStreams[k] = new Stream();
    }

    // TODO: can we do this without a closure?
    const setOutputs = (changedOutputs) => {
      const pq = this.priorityQueue;

      // For each changed output, save to stream and insert PQ tasks for downstream ports
      for (const outPort in changedOutputs) {
        // TODO: I think we can do a sanity check here: if the lastChangedInstant of this
        //  stream is the current instant, then we are in some kind of cycle or a node
        //  has misbehaved and output more than once
        outputStreams[outPort].setValue(changedOutputs[outPort], this.currentInstant);

        // Copy values to downstream and insert PQ tasks
        for (const cid of outputCxns[outPort]) {
          const cxn = this.cxnMap[cid];
          const downstreamNodeId = cxn.toNodeId;
          const downstreamInputStream = this.nodeMap.get(downstreamNodeId).inputStreams[cxn.toPort];
          downstreamInputStream.copyFrom(outputStreams[outPort]);
          this.insertNodeTask(downstreamNodeId);
        }
      }

      if (!this.pumping) {
        this.pump();
      }
    };

    // TODO: can we do this without a closure?
    const setState = (newState) => {
      // TODO: implement
    };

    // Build context object
    const context = {
      setOutputs,
      state: null,
      setState,
      transient: null,
    };

    // Instantiate node
    // NOTE: This doesn't actually return anything, create() calls
    //  functions in context to set outputs, store state, etc.
    nodeDef.create(context);

    // Make record in map
    this.nodeMap.set(nid, {
      nodeDef,
      context,
      inputCxns,
      outputCxns,
      inputStreams,
      outputStreams,
      // toposortIndex: null, // since not connected, no index
      toposortIndex: nid, // TODO: unhack (restore line above) when we have toposort
    });

    return nid;
  }

  addConnection(fromNodeId, fromPort, toNodeId, toPort) {
    const cid = this.nextCxnId;
    this.nextCxnId++;

    // TODO: we could sanity check node ids and port names

    const fromNode = this.nodeMap.get(fromNodeId);
    const toNode = this.nodeMap.get(toNodeId);

    if (toNode.inputCxns[toPort]) {
      throw new Error('input port already has a connection');
    }

    fromNode.outputCxns[fromPort].push(cid);
    toNode.inputCxns[toPort] = cid;

    this.cxnMap[cid] = {
      fromNodeId,
      fromPort,
      toNodeId,
      toPort,
    };

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
        const inputStream = nodeRec.inputStreams[k];
        const changed =  inputStream.instant === instant;

        inputs[k] = {
          value: (nodeRec.nodeDef.inputs[k].tempo === 'event') ? (changed ? inputStream.latestValue : undefined) : inputStream.latestValue,
          changed,
        };
      }
      nodeRec.nodeDef.update(nodeRec.context, inputs);
    }

    this.currentInstant++;
  }
}
