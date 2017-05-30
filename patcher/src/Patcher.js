import React, { Component } from 'react';
import { Map as IMap, Record } from 'immutable';

import DynamicRuntime from 'dynamic-runtime';
import './Patcher.css';
import CreateNodeBox from './CreateNodeBox';
import NodePool from './NodePool';

const NodeRecord = Record({
  name: null,
  position: null, // {x, y}
  def: null,
});

const CxnRecord = Record({
});

class Patcher extends Component {
  constructor(props) {
    super(props);

    // Positions in state are relative to patcher element
    this.state = {
      mouseDownPos: null,
      createNodeBoxPos: null,
      nodeMap: new IMap(), // node id -> NodeRecord
      cxnMap: new IMap(), // cxn id -> CxnRecord
      selectedPort: null,
    };

    this.runtime = new DynamicRuntime();
    this.nodePool = new NodePool(); // TODO: this should probably be passed as a prop, but let's load directly for now

    this.mouseCaptured = false;
    this.rootElem = null;
    this.canvasElem = null;
    this.portElemMap = new Map(); // maps special port strings to elements

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleCreateNodeBoxSelect = this.handleCreateNodeBoxSelect.bind(this);
    this.handleCreateNodeBoxCancel = this.handleCreateNodeBoxCancel.bind(this);
    this.handlePortClick = this.handlePortClick.bind(this);
    this.savePortElem = this.savePortElem.bind(this);
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

  handleMouseDown(e) {
    if (e.target === this.rootElem) {
      this.captureMouse();
      this.setState({
        mouseDownPos: this.eventRelativePosition(e.nativeEvent),
      });
      e.preventDefault();
    }
  }

  handleMouseMove(e) {
  }

  handleMouseUp(e) {
    if (this.mouseCaptured) {
      this.releaseMouse();

      const pos = this.eventRelativePosition(e);

      const delta = Math.abs(pos.x - this.state.mouseDownPos.x) + Math.abs(pos.y - this.state.mouseDownPos.y);
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

      this.setState({
        mouseDownPos: null,
      });
    }
  }

  closeCreateNodeBox() {
    this.setState({
      createNodeBoxPos: null,
    });
  }

  handleCreateNodeBoxSelect(nodeName, nodeDef) {
    const nid = this.runtime.addNode(nodeDef);
    this.setState((state) => {
      const position = Object.assign({}, state.createNodeBoxPos); // copy create box position
      return { ...state, nodeMap: state.nodeMap.set(nid, new NodeRecord({name: nodeName, position, def: nodeDef}))};
    });
    this.closeCreateNodeBox();
  }

  handleCreateNodeBoxCancel() {
    this.closeCreateNodeBox();
  }

  handlePortClick(nodeId, isInput, portName) {
    this.setState((state) => {
      if (state.selectedPort) {
        // Attempt connection between selected port and this port
        let a = state.selectedPort;
        let b = {nodeId, isInput, portName};
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
          const cid = this.runtime.addConnection(a.nodeId, a.portName, b.nodeId, b.portName);

          // Clear selected port, add cxn to map
          return {...state, selectedPort: null, cxnMap: state.cxnMap.set(cid, new CxnRecord({}))};
        }
      } else {
        // Set as selected port
        return {...state, selectedPort: {nodeId, isInput, portName}};
      }
    });
  }

  formatPortStr(nodeId, isInput, portName) {
    return nodeId + '|' + isInput + '|' + portName;
  }

  savePortElem(elem, nodeId, isInput, portName) {
    this.portElemMap.set(this.formatPortStr(nodeId, isInput, portName), elem);
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

    for (const [cid, ] of this.state.cxnMap.entries()) {
      const icxn = this.runtime.cxnMap.get(cid); // TODO: unhack this direct access
      const fromPortStr = this.formatPortStr(icxn.fromNodeId, false, icxn.fromPort);
      const toPortStr = this.formatPortStr(icxn.toNodeId, true, icxn.toPort);

      const fromPortElem = this.portElemMap.get(fromPortStr);
      const toPortElem = this.portElemMap.get(toPortStr);

      const fromPos = portElemConnectPos(fromPortElem);
      const toPos = portElemConnectPos(toPortElem);

      ctx.strokeStyle = 'rgb(255, 255, 255)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.lineTo(toPos.x, toPos.y);
      ctx.stroke();
    }
  }

  render() {
    const renderedNodes = [];
    for (const [nid, nodeRec] of this.state.nodeMap.entries()) {
      const inputPorts = [];
      const outputPorts = [];
      for (const p in nodeRec.def.inputs) {
        inputPorts.push({name: p});
      }
      for (const p in nodeRec.def.outputs) {
        outputPorts.push({name: p});
      }

      const renderPort = (p, isInput) => {
        const sp = this.state.selectedPort;
        const selected = sp && (nid === sp.nodeId) && (isInput === sp.isInput) && (p.name === sp.portName);

        return (
          <div key={p.name} onClick={() => { this.handlePortClick(nid, isInput, p.name); }} ref={el => { this.savePortElem(el, nid, isInput, p.name); }} className={'Patcher_node-port' + (selected ? ' Patcher_node-port-selected' : '')}>{p.name}</div>
        );
      };

      renderedNodes.push(
        <div key={nid} className="Patcher_node" style={{position: 'absolute', left: nodeRec.position.x, top: nodeRec.position.y}}>
          <div className="Patcher_node-header">{nodeRec.name}<div className="Patcher_node-header-buttons">✕</div></div>
          <div className="Patcher_node-ports">
            <div className="Patcher_node-input-ports">{inputPorts.map(p => renderPort(p, true))}</div>
            <div className="Patcher_node-output-ports">{outputPorts.map(p => renderPort(p, false))}</div>
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
