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
    name: 'show time',
    run: (patcher) => {
      const atId = patcher.addNode(nodeDefs.animationTime);
      const ssId = patcher.addNode(nodeDefs.showString);
      patcher.addConnection(atId, 'time', ssId, 'v');
    },
  },
]
