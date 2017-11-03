import * as nodeDefs from 'node-definitions';

export default [
  {
    name: 'follow mouse',
    run: (runtime) => {
      const root = runtime.addRootUserDefinition();
      const mpId = runtime.addNativeApplication(root, nodeDefs.mousePos);
      const rsId = runtime.addNativeApplication(root, nodeDefs.redSquare);
      runtime.addConnection(mpId.outPorts.get('x'), rsId.inPorts.get('x'));
      runtime.addConnection(mpId.outPorts.get('y'), rsId.inPorts.get('y'));
      runtime.activateClosedDefinition(root);
    },
  },

  {
    name: 'follow mouse with x/y swapped',
    run: (runtime) => {
      const mpId = runtime.addNode(nodeDefs.mousePos);
      const rsId = runtime.addNode(nodeDefs.redSquare);
      runtime.addConnection(mpId, 'x', rsId, 'y');
      runtime.addConnection(mpId, 'y', rsId, 'x');
    },
  },

  {
    name: 'show mouse x',
    run: (runtime) => {
      const mpId = runtime.addNode(nodeDefs.mousePos);
      const ssId = runtime.addNode(nodeDefs.showString);
      runtime.addConnection(mpId, 'x', ssId, 'v');
    },
  },

  {
    name: 'show mouse down',
    run: (runtime) => {
      const mpId = runtime.addNode(nodeDefs.mouseDown);
      const ssId = runtime.addNode(nodeDefs.showString);
      runtime.addConnection(mpId, 'down', ssId, 'v');
    },
  },

  {
    name: 'show time',
    run: (runtime) => {
      const atId = runtime.addNode(nodeDefs.animationTime);
      const ssId = runtime.addNode(nodeDefs.showString);
      runtime.addConnection(atId, 'time', ssId, 'v');
    },
  },

  {
    name: 'noise',
    run: (runtime) => {
      const amId = runtime.addNode(nodeDefs.audioManager);
      const nzId = runtime.addNode(nodeDefs.noise);
      runtime.addConnection(amId, 'renderAudio', nzId, 'renderAudio');
      runtime.addConnection(nzId, 'audioBuffer', amId, 'audioBuffer');
    },
  },

  {
    name: 'noise while mouse down',
    run: (runtime) => {
      const mdId = runtime.addNode(nodeDefs.mouseDown);
      const amId = runtime.addNode(nodeDefs.audioManager);
      const nzId = runtime.addNode(nodeDefs.noise);
      const bgId = runtime.addNode(nodeDefs.boolToAudioGate);
      const multId = runtime.addNode(nodeDefs.multiplier);

      runtime.addConnection(mdId, 'down', bgId, 'on');

      runtime.addConnection(amId, 'renderAudio', nzId, 'renderAudio');
      runtime.addConnection(amId, 'renderAudio', bgId, 'renderAudio');
      runtime.addConnection(amId, 'renderAudio', multId, 'renderAudio');

      runtime.addConnection(nzId, 'audioBuffer', multId, 'a');

      runtime.addConnection(bgId, 'audioBuffer', multId, 'b');

      runtime.addConnection(multId, 'audioBuffer', amId, 'audioBuffer');
    },
  },

  {
    name: 'count mouse clicks',
    run: (runtime) => {
      const mcId = runtime.addNode(nodeDefs.mouseClick);
      const ecId = runtime.addNode(nodeDefs.eventCount);
      const ssId = runtime.addNode(nodeDefs.showString);
      runtime.addConnection(mcId, 'click', ecId, 'events');
      runtime.addConnection(ecId, 'count', ssId, 'v');
    },
  },
]
