import React, { Component } from 'react';
import { Map as IMap, Record } from 'immutable';

import DynamicRuntime from 'dynamic-runtime';
import './Patcher.css';
import CreateNodeBox from './CreateNodeBox';
import NodePool from './NodePool';
import genUID from './uid';

const NodeRecord = Record({
  uid: null,
  name: null,
  position: null, // {x, y}
  def: null,
});

class Patcher extends Component {
  constructor(props) {
    super(props);

    // Positions in state are relative to patcher element
    this.state = {
      viewOffset: {x: 0, y: 0},
      createNodeBoxPos: null,
      nodeMap: new IMap(), // NativeApplication -> NodeRecord
      selectedPort: null,
    };

    this.runtime = new DynamicRuntime();
    this.rootDefinition = this.runtime.addRootUserDefinition();
    this.rootActivation = this.runtime.activateClosedDefinition(this.rootDefinition, {}, () => {});
    this.nodePool = new NodePool(); // TODO: this should probably be passed as a prop, but let's load directly for now

    this.mouseCaptured = false;
    this.mouseDownPos = null;
    this.mouseLastPos = null; // only during drag/down
    this.rootElem = null;
    this.canvasElem = null;
    this.portElemMap = new Map(); // maps InPort or OutPort to DOM element representing the port
  }

  componentWillUnmount() {
    if (this.mouseCaptured) {
      this.releaseMouse();
    }
  }

  componentDidMount() {
    this.updateCanvas();
  }

  componentDidUpdate() {
    this.updateCanvas();
  }

  eventRelativePosition(event) {
    return {
      x: event.pageX - this.rootElem.offsetLeft,
      y: event.pageY - this.rootElem.offsetTop,
    };
  }

  captureMouse() {
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    this.mouseCaptured = true;
  }

  releaseMouse() {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    this.mouseCaptured = false;
  }

  handleMouseDown = (e) => {
    if (e.target === this.rootElem) {
      this.captureMouse();
      const pos = this.eventRelativePosition(e.nativeEvent);
      this.mouseDownPos = pos;
      this.mouseLastPos = pos;
      e.preventDefault();
    }
  }

  handleMouseMove = (e) => {
    if (!this.mouseDownPos) {
      throw new Error('internal error');
    }

    const pos = this.eventRelativePosition(e);
    const dx = pos.x - this.mouseLastPos.x;
    const dy = pos.y - this.mouseLastPos.y;
    this.mouseLastPos = pos;

    this.setState((state) => ({...state, viewOffset: {x: state.viewOffset.x + dx, y: state.viewOffset.y + dy}}));
  }

  handleMouseUp = (e) => {
    if (this.mouseCaptured) {
      this.releaseMouse();

      const pos = this.eventRelativePosition(e);

      const delta = Math.abs(pos.x - this.mouseDownPos.x) + Math.abs(pos.y - this.mouseDownPos.y);
      if (delta === 0) {
        // This was a click (no movement)
        if (this.state.createNodeBoxPos) {
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
              createNodeBoxPos: pos,
            });
          }
        }
      }

      this.mouseDownPos = null;
      this.mouseLastPos = null;
    }
  }

  closeCreateNodeBox() {
    this.setState({
      createNodeBoxPos: null,
    });
  }

  handleCreateNodeBoxSelect = (nodeName, nodeDef) => {
    const app = this.runtime.addNativeApplication(this.rootDefinition, nodeDef, new Map());
    this.setState((state) => {
      const position = Object.assign({}, state.createNodeBoxPos); // copy create box position
      return { ...state, nodeMap: state.nodeMap.set(app, new NodeRecord({uid: genUID(), name: nodeName, position, def: nodeDef}))};
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
          // Tell runtime to make connection
          this.runtime.addConnection(a.portObj, b.portObj);

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
    this.runtime.disconnectPort(portObj);
    this.forceUpdate(); // since we don't keep connections in our own state, need to force to see update
  }

  formatPortStr(nodeId, isInput, portName) {
    return nodeId + '|' + isInput + '|' + portName;
  }

  handleRemoveNode = (nodeId) => {
    this.runtime.removeNode(nodeId);
    this.setState((state) => {
      return { ...state, nodeMap: state.nodeMap.delete(nodeId)};
    });
  }

  updateCanvas() {
    this.canvasElem.width = this.canvasElem.offsetWidth;
    this.canvasElem.height = this.canvasElem.offsetHeight;

    const portElemConnectPos = (elem, isInput) => {
      let x = isInput ? 0 : elem.offsetWidth;
      let y = 0.5*elem.offsetHeight;

      let e = elem;
      while (e !== this.rootElem) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent;
      }

      return {x, y};
    }

    const ctx = this.canvasElem.getContext('2d');

    ctx.clearRect(0, 0, this.canvasElem.width, this.canvasElem.height);

    ctx.strokeStyle = 'rgb(255, 255, 255)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const icxn of this.runtime.connections) { // TODO: unhack this direct access
      const fromPortElem = this.portElemMap.get(icxn.outPort);
      const toPortElem = this.portElemMap.get(icxn.inPort);

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

  render() {
    const renderedNodes = [];
    for (const napp of this.rootDefinition.nativeApplications) {
      const nodeRec = this.state.nodeMap.get(napp);

      const inputPorts = [];
      const outputPorts = [];
      for (const [n, p] of napp.inPorts) {
        inputPorts.push({name: n, portObj: p});
      }
      for (const [n, p] of napp.outPorts) {
        outputPorts.push({name: n, portObj: p});
      }

      const renderPort = (name, portObj, isInput) => {
        const sp = this.state.selectedPort;
        const selected = sp && (sp.portObj === portObj);

        return (
          <div key={name} onClick={() => { this.handlePortClick(portObj, isInput); }} onDoubleClick={() => { this.handlePortDoubleClick(portObj); }} ref={el => { this.portElemMap.set(portObj, el); }} className={'Patcher_node-port' + (selected ? ' Patcher_node-port-selected' : '')}>{name}</div>
        );
      };

      renderedNodes.push(
        <div key={nodeRec.uid} className="Patcher_node" style={{position: 'absolute', left: nodeRec.position.x +  + this.state.viewOffset.x, top: nodeRec.position.y + this.state.viewOffset.y}}>
          <div className="Patcher_node-header">{nodeRec.name}<div className="Patcher_node-header-buttons"><button onClick={() => { this.handleRemoveNode(nodeRec.uid); }}>✕</button></div></div>
          <div className="Patcher_node-ports">
            <div className="Patcher_node-input-ports">{inputPorts.map(p => renderPort(p.name, p.portObj, true))}</div>
            <div className="Patcher_node-output-ports">{outputPorts.map(p => renderPort(p.name, p.portObj, false))}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="Patcher" ref={(el) => { this.rootElem = el; }} onMouseDown={this.handleMouseDown} onMouseUp={this.handleMouseUp}>
        <canvas ref={canvas => { this.canvasElem = canvas; }} />
        <div>{renderedNodes}</div>
        {this.state.createNodeBoxPos &&
          <div style={{position: 'absolute', left: this.state.createNodeBoxPos.x, top: this.state.createNodeBoxPos.y}}><CreateNodeBox width={200} nodePool={this.nodePool} onSelect={this.handleCreateNodeBoxSelect} onCancel={this.handleCreateNodeBoxCancel} /></div>
        }
      </div>
    );
  }
}

export default Patcher;
