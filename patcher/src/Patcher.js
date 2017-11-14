import React, { Component } from 'react';
import { Map as IMap, Record } from 'immutable';

import { createRootUserDefinition } from 'dynamic-runtime';
import './Patcher.css';
import CreateNodeBox from './CreateNodeBox';
import NodePool from './NodePool';
import genUID from './uid';

const AppExtra = Record({
  uid: null,
  name: null,
  position: null, // {x, y}
  def: null,
  functionArguments: null,
});

const DefExtra = Record({
  viewOffset: null, // {x, y}
});

class Patcher extends Component {
  constructor(props) {
    super(props);

    this.rootDefinition = createRootUserDefinition();
    this.rootActivation = this.rootDefinition.activate(new Map(), () => {}, new Map());
    this.nodePool = new NodePool(); // TODO: this should probably be passed as a prop, but let's load directly for now

    // Positions in state are relative to patcher element
    this.state = {
      creatingNode: null,
      appExtra: new IMap(), // NativeApplication -> AppExtra
      defExtra: new IMap([[this.rootDefinition, new DefExtra({viewOffset: {x: 0, y: 0}})]])

      , // UserDefinition -> DefExtra
      selectedPort: null,
    };

    this.drag = null;

    this.rootElem = null;
    this.canvasElem = null;

    // We use WeakMaps here so that old keys don't need to be removed
    this.portElemMap = new WeakMap(); // maps InPort or OutPort to DOM element representing the port
    this.defPositioningElemMap = new WeakMap(); // maps UserDefinition to DOM element
  }

  componentWillUnmount() {
    if (this.drag) {
      this.endDrag();
    }
  }

  componentDidMount() {
    this.updateCanvas();
  }

  componentDidUpdate() {
    this.updateCanvas();
  }

  elemRelativePosition(elem) {
    let x = 0, y = 0;

    while (elem !== this.rootElem) {
      x += elem.offsetLeft;
      y += elem.offsetTop;
      elem = elem.offsetParent;
    }

    return {x, y};
  }

  eventRelativePosition(event) {
    return {
      x: event.pageX - this.rootElem.offsetLeft,
      y: event.pageY - this.rootElem.offsetTop,
    };
  }

  beginDrag(mouseEvent, target) {
    if (this.drag) {
      throw new Error('internal error');
    }

    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);

    const pos = this.eventRelativePosition(mouseEvent.nativeEvent);

    this.drag = {
      target,
      downPos: pos,
      lastPos: pos,
    };
  }

  endDrag() {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    this.drag = null;
  }

  handleDefinitionMouseDown = (definition, event) => {
    if (event.target === event.currentTarget) {
      this.beginDrag(event, {
        kind: 'definition',
        definition,
      });
      event.preventDefault();
    }
  }

  handleMouseMove = (e) => {
    if (!this.drag) {
      throw new Error('internal error');
    }

    const pos = this.eventRelativePosition(e);
    const dx = pos.x - this.drag.lastPos.x;
    const dy = pos.y - this.drag.lastPos.y;
    this.drag.lastPos = pos;

    if (this.drag.target.kind === 'definition') {
      const definition = this.drag.target.definition;
      this.setState((state) => ({...state, defExtra: state.defExtra.updateIn([definition, 'viewOffset'], vo => ({x: vo.x + dx, y: vo.y + dy}))}));
    }
  }

  handleMouseUp = (e) => {
    if (this.drag) {
      const pos = this.eventRelativePosition(e);

      const delta = Math.abs(pos.x - this.drag.downPos.x) + Math.abs(pos.y - this.drag.downPos.y);

      if (this.drag.target.kind === 'definition') {
        if (delta === 0) {
          // This was a click (no movement)
          if (this.state.creatingNode) {
            // If a box is already being shown, close it
            this.closeCreateNodeBox();
          } else {
            if (this.state.selectedPort) {
              this.setState({
                selectedPort: null,
              });
            } else {
              // If no box is shown, show it at the click position
              this.setState({
                creatingNode: {
                  boxPosition: pos,
                  definition: this.drag.target.definition,
                },
              });
            }
          }
        }
      }

      this.endDrag();
    }
  }

  closeCreateNodeBox() {
    this.setState({
      creatingNode: null,
    });
  }

  handleCreateNodeBoxSelect = (nodeName, nodeDef) => {
    if (!this.state.creatingNode) {
      throw new Error('internal error');
    }

    // Look up what definition this creation is happening within
    const definition = this.state.creatingNode.definition;

    // If the definition has function parameters, created sub-definitions for each one
    const functionArguments = new Map();
    if (nodeDef.functionParameters) {
      for (const n in nodeDef.functionParameters) {
        const subdef = definition.addContainedUserDefinition();
        this.setState(state => ({...state, defExtra: state.defExtra.set(subdef, new DefExtra({viewOffset: {x: 0, y: 0}}))}));
        functionArguments.set(n, subdef);
      }
    }

    const app = definition.addNativeApplication(nodeDef, functionArguments);

    this.setState((state) => {
      const boxPos = state.creatingNode.boxPosition;
      const offset = this.elemRelativePosition(this.defPositioningElemMap.get(definition));
      const position = {
        x: boxPos.x - offset.x,
        y: boxPos.y - offset.y,
      };

      const appExtra = new AppExtra({
        uid: genUID(),
        name: nodeName,
        position,
        def: nodeDef,
        functionArguments,
      });

      return {...state, appExtra: state.appExtra.set(app, appExtra)};
    });

    this.closeCreateNodeBox();
  }

  handleCreateNodeBoxCancel = () => {
    this.closeCreateNodeBox();
  }

  handlePortClick = (portObj, isInput) => {
    this.setState((state) => {
      if (state.selectedPort) {
        // Attempt connection between selected port and this port
        let a = state.selectedPort;
        let b = {portObj, isInput};
        let invalid = false;
        if (a.isInput) {
          if (b.isInput) {
            invalid = true;
          } else {
            [a, b] = [b, a]; // swap
          }
        } else {
          if (b.isInput) {
            // all good
          } else {
            invalid = true;
          }
        }

        if (invalid) {
          return state; // ignore
        } else {
          a.portObj.containingDefinition.addConnection(a.portObj, b.portObj);

          // Clear selected port
          return {...state, selectedPort: null};
        }
      } else {
        // Set as selected port
        return {...state, selectedPort: {portObj, isInput}};
      }
    });
  }

  handlePortDoubleClick = (portObj) => {
    this.rootDefinition.disconnectPort(portObj);
    this.forceUpdate(); // since we don't keep connections in our own state, need to force to see update
  }

  formatPortStr(nodeId, isInput, portName) {
    return nodeId + '|' + isInput + '|' + portName;
  }

  handleRemoveNode = (nodeId) => {
    this.rootDefinition.removeNode(nodeId);
    this.setState((state) => {
      return { ...state, appExtra: state.appExtra.delete(nodeId)};
    });
  }

  updateCanvas() {
    this.canvasElem.width = this.canvasElem.offsetWidth;
    this.canvasElem.height = this.canvasElem.offsetHeight;

    const portElemConnectPos = (elem, isInput) => {
      const pos = this.elemRelativePosition(elem);

      return {
        x: pos.x + (isInput ? 0 : elem.offsetWidth),
        y: pos.y + 0.5*elem.offsetHeight,
      };
    }

    const ctx = this.canvasElem.getContext('2d');

    ctx.clearRect(0, 0, this.canvasElem.width, this.canvasElem.height);

    ctx.strokeStyle = 'rgb(255, 255, 255)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const cxn of this.rootDefinition.deepConnections()) {
      const fromPortElem = this.portElemMap.get(cxn.outPort);
      const toPortElem = this.portElemMap.get(cxn.inPort);

      const fromPos = portElemConnectPos(fromPortElem);
      const toPos = portElemConnectPos(toPortElem, true);

      // Place cp1 right of fromPos, cp2 left of toPos
      const STRAIN_RELIEF = 100;
      const cp1x = fromPos.x +STRAIN_RELIEF;
      const cp2x = toPos.x - STRAIN_RELIEF;
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.bezierCurveTo(cp1x, fromPos.y, cp2x, toPos.y, toPos.x, toPos.y);
    }
    ctx.stroke();
  }

  renderPort(name, portObj, isInput) {
    const sp = this.state.selectedPort;
    const selected = sp && (sp.portObj === portObj);

    return (
      <div key={name} onClick={() => { this.handlePortClick(portObj, isInput); }} onDoubleClick={() => { this.handlePortDoubleClick(portObj); }} ref={el => { this.portElemMap.set(portObj, el); }} className={'Patcher_node-port' + (selected ? ' Patcher_node-port-selected' : '')}>{name}</div>
    );
  }

  renderApplication(napp) {
    const appExtra = this.state.appExtra.get(napp);

    const inputPorts = [];
    const outputPorts = [];
    for (const [n, p] of napp.inPorts) {
      inputPorts.push({name: n, portObj: p});
    }
    for (const [n, p] of napp.outPorts) {
      outputPorts.push({name: n, portObj: p});
    }

    return (
      <div key={appExtra.uid} className="Patcher_node" style={{position: 'absolute', left: appExtra.position.x, top: appExtra.position.y}}>
        <div className="Patcher_node-header">{appExtra.name}<div className="Patcher_node-header-buttons"><button onClick={() => { this.handleRemoveNode(appExtra.uid); }}>✕</button></div></div>
        <div className="Patcher_node-ports">
          <div className="Patcher_node-input-ports">{inputPorts.map(p => this.renderPort(p.name, p.portObj, true))}</div>
          <div className="Patcher_node-output-ports">{outputPorts.map(p => this.renderPort(p.name, p.portObj, false))}</div>
        </div>
        {(appExtra.functionArguments.size > 0) &&
          <div className="Patcher_node-inline-defs">
            {[...appExtra.functionArguments.entries()].map(([n, subdef]) => (
              <div className="Patcher_node-inline-def" key={n}>
                {this.renderDefinition(subdef)}
              </div>
            ))}
          </div>
        }
      </div>
    );
  }

  renderDefinition(definition) {
    const viewOffset = this.state.defExtra.get(definition).viewOffset;

    return (
      <div className="Patcher_definition" onMouseDown={(e) => { this.handleDefinitionMouseDown(definition, e); }}>
        <div style={{position: 'absolute', left: viewOffset.x, top: viewOffset.y, background: 'transparent'}} ref={el => { this.defPositioningElemMap.set(definition, el); }}>
          {[...definition.nativeApplications].map(napp => this.renderApplication(napp))}
        </div>
      </div>
    );
  }

  render() {
    return (
      <div className="Patcher" ref={(el) => { this.rootElem = el; }}>
        {this.renderDefinition(this.rootDefinition)}
        <canvas ref={canvas => { this.canvasElem = canvas; }} />
        {this.state.creatingNode &&
          <div style={{position: 'absolute', left: this.state.creatingNode.boxPosition.x, top: this.state.creatingNode.boxPosition.y}}><CreateNodeBox width={200} nodePool={this.nodePool} onSelect={this.handleCreateNodeBoxSelect} onCancel={this.handleCreateNodeBoxCancel} /></div>
        }
      </div>
    );
  }
}

export default Patcher;
