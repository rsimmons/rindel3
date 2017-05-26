import * as nodeDefs from './nodeDefs';

export default [
  {
    name: 'follow mouse',
    run: (patcher) => {
      const mpId = patcher.addNode(nodeDefs.mousePos);
      const rsId = patcher.addNode(nodeDefs.redSquare);
      patcher.addConnection(mpId, 'x', rsId, 'x');
      patcher.addConnection(mpId, 'y', rsId, 'y');
    },
  },

  {
    name: 'follow mouse with x/y swapped',
    run: (patcher) => {
      const mpId = patcher.addNode(nodeDefs.mousePos);
      const rsId = patcher.addNode(nodeDefs.redSquare);
      patcher.addConnection(mpId, 'x', rsId, 'y');
      patcher.addConnection(mpId, 'y', rsId, 'x');
    },
  },

  {
    name: 'show mouse x',
    run: (patcher) => {
      const mpId = patcher.addNode(nodeDefs.mousePos);
      const ssId = patcher.addNode(nodeDefs.showString);
      patcher.addConnection(mpId, 'x', ssId, 'v');
    },
  },

  {
    name: 'show mouse down',
    run: (patcher) => {
      const mpId = patcher.addNode(nodeDefs.mouseDown);
      const ssId = patcher.addNode(nodeDefs.showString);
      patcher.addConnection(mpId, 'down', ssId, 'v');
    },
  },

  {
    name: 'show time',
    run: (patcher) => {
      const atId = patcher.addNode(nodeDefs.animationTime);
      const ssId = patcher.addNode(nodeDefs.showString);
      patcher.addConnection(atId, 'time', ssId, 'v');
    },
  },

  {
    name: 'noise',
    run: (patcher) => {
      const amId = patcher.addNode(nodeDefs.audioManager);
      const nzId = patcher.addNode(nodeDefs.noise);
      patcher.addConnection(amId, 'renderAudio', nzId, 'renderAudio');
      patcher.addConnection(nzId, 'audioBuffer', amId, 'audioBuffer');
    },
  },

  {
    name: 'noise while mouse down',
    run: (patcher) => {
      const mdId = patcher.addNode(nodeDefs.mouseDown);
      const amId = patcher.addNode(nodeDefs.audioManager);
      const nzId = patcher.addNode(nodeDefs.noise);
      const bgId = patcher.addNode(nodeDefs.boolToAudioGate);
      const multId = patcher.addNode(nodeDefs.multiplier);

      patcher.addConnection(mdId, 'down', bgId, 'on');

      patcher.addConnection(amId, 'renderAudio', nzId, 'renderAudio');
      patcher.addConnection(amId, 'renderAudio', bgId, 'renderAudio');
      patcher.addConnection(amId, 'renderAudio', multId, 'renderAudio');

      patcher.addConnection(nzId, 'audioBuffer', multId, 'a');

      patcher.addConnection(bgId, 'audioBuffer', multId, 'b');

      patcher.addConnection(multId, 'audioBuffer', amId, 'audioBuffer');
    },
  },

  {
    name: 'count mouse clicks',
    run: (patcher) => {
      const mcId = patcher.addNode(nodeDefs.mouseClick);
      const ecId = patcher.addNode(nodeDefs.eventCount);
      const ssId = patcher.addNode(nodeDefs.showString);
      patcher.addConnection(mcId, 'click', ecId, 'events');
      patcher.addConnection(ecId, 'count', ssId, 'v');
    },
  },
]
