import React, { Component } from 'react';
import { Map as IMap, Record } from 'immutable';

import { createRootUserClosure } from 'dynamic-runtime';
import './Patcher.css';
import CreateNodeBox from './CreateNodeBox';
import FlashMessage from './FlashMessage';
import NodePool from './NodePool';
import genUID from './uid';

const AppExtra = Record({
  uid: null,
  position: null, // {x, y}
  defName: null,
  def: null,
  functionArguments: null,
  uiInstance: null,
});

const DefExtra = Record({
  viewOffset: null, // {x, y}
});

class ApplicationSettings extends Component {
  constructor(props) {
    super(props);

    this.uiInstance = null;
    this.containerElem = null;
  }

  componentDidMount() {
    const {uiClass, initialSettings, onChangeSettings} = this.props;

    // Create UI into container elem
    this.uiInstance = new uiClass(this.containerElem, initialSettings, (newSettings) => {
      onChangeSettings(newSettings);
    });
  }

  componentWillUnmount() {
    if (this.uiInstance && this.uiInstance.destroy) {
      this.uiInstance.destroy();
    }
  }

  render() {
    return (
      <div ref={el => { this.containerElem = el; }} />
    );
  }
}

class Patcher extends Component {
  constructor(props) {
    super(props);

    this.rootClosure = null;
    this.rootDefinition = null;
    this.rootActivation = null;

    this.nodePool = new NodePool(); // TODO: this should probably be passed as a prop, but let's load directly for now

    // Positions in state are relative to patcher element
    this.state = {
      creatingNode: null,
      appExtra: null, // NativeApplication -> AppExtra
      defExtra: null, // UserDefinition -> DefExtra
      selectedPort: null,
    };

    this.drag = null;

    this.rootElem = null;
    this.canvasElem = null;

    // We use WeakMaps here so that old keys don't need to be removed
    this.portElemMap = new WeakMap(); // maps InPort or OutPort to DOM element representing the port
    this.defPositioningElemMap = new WeakMap(); // maps UserDefinition to DOM element
  }

  componentWillMount() {
    // NOTE: We put this here instead of in constructor because it uses setState which we're not
    // supposed to call in the constructor.
    this.load();
  }

  componentDidMount() {
    document.addEventListener('copy', this.handleCopy);
    document.addEventListener('paste', this.handlePaste);

    this.updateCanvas();
  }

  componentWillUnmount() {
    document.removeEventListener('copy', this.handleCopy);
    document.removeEventListener('paste', this.handlePaste);

    if (this.drag) {
      this.endDrag();
    }
  }

  componentDidUpdate() {
    this.updateCanvas();
  }

  load(patchData) {
    if (this.rootActivation) {
      this.rootActivation.destroy();
    }

    const appExtra = new Map();
    const defExtra = new Map();

    if (patchData) {
      try {
        const appMap = new Map(); // app number to object
        const defMap = new Map(); // def number to object

        const loadSignature = (loadDef) => {
          const TEMPO_LONGFORM = new Map([['s', 'step'], ['e', 'event']]);
          const loadPortSig = (lps) => ({
            tempo: TEMPO_LONGFORM.get(lps.t),
            ...(lps.n ? {name: lps.name} : {}),
          });

          const signature = {};

          if (loadDef.di) {
            signature.inputs = loadDef.di.map(inp => loadPortSig(inp));
          } else {
            signature.inputs = [];
          }

          if (loadDef.dos) {
            signature.outputs = {};
            for (const n in loadDef.dos) {
              signature.outputs[n] = loadPortSig(loadDef.dos[n]);
            }
          } else if (loadDef.do) {
            signature.output = loadPortSig(loadDef.do);
          } else {
            signature.output = null;
          }

          return signature;
        };

        const loadDefinition = (loadDef, intoDef) => {
          defMap.set(loadDef.i, intoDef);

          // TODO: actually load the view offset
          defExtra.set(intoDef, new DefExtra({viewOffset: {x: 0, y: 0}}));

          for (const loadSubdef of (loadDef.sd || [])) {
            const subdef = intoDef.addContainedUserDefinition(loadSignature(loadSubdef));
            loadDefinition(loadSubdef, subdef);
          }

          for (const loadApp of loadDef.a) {
            const defName = loadApp.d;
            const def = this.nodePool.lookup(defName);

            const functionArguments = new Map();
            if (loadApp.fa) {
              for (const n in loadApp.fa) {
                functionArguments.set(n, defMap.get(loadApp.fa[n]));
              }
            }

            const app = intoDef.addNativeApplication(def, functionArguments, loadApp.s);

            appMap.set(loadApp.i, app);

            appExtra.set(app, new AppExtra({
              uid: genUID(),
              position: loadApp.p,
              defName,
              def,
              functionArguments,
            }));
          }

          for (const loadCxn of loadDef.c) {
            let outPort;
            switch (loadCxn.o.t) {
              case 'a': {
                  const app = appMap.get(loadCxn.o.a);
                  const which = loadCxn.o.w;
                  if (which) {
                    // TODO: implement
                    throw new Error('unimplemented');
                  } else {
                    outPort = app.output;
                  }
                }
                break;

              case 'd':
                outPort = intoDef.definitionInputs[loadCxn.o.w];
                break;

              default:
                throw new Error('?');
            }

            let inPort;
            switch (loadCxn.i.t) {
              case 'a': {
                  const app = appMap.get(loadCxn.i.a);
                  const which = loadCxn.i.w;
                  inPort = app.inputs[which];
                }
                break;

              case 'd': {
                  const inPortDef = (loadCxn.i.d === undefined) ? intoDef : defMap.get(loadCxn.i.d);
                  if (inPortDef.definitionOutput instanceof Map) {
                    // TODO: implement
                    throw new Error('unimplemented');
                  } else {
                    if (!inPortDef.definitionOutput) {
                      throw new Error('internal error');
                    }
                    inPort = inPortDef.definitionOutput;
                  }
                }
                break;

              default:
                throw new Error('?');
            }

            intoDef.addConnection(outPort, inPort);
          }
        };

        const patchObj = JSON.parse(patchData);

        if (patchObj.r3v !== 1) {
          throw new Error('magic number missing, not a patch');
        }

        this.rootClosure = createRootUserClosure(loadSignature(patchObj.d));
        this.rootDefinition = this.rootClosure.definition;

        loadDefinition(patchObj.d, this.rootDefinition);
      } catch(e) {
        // TODO: handle more gracefully
        console.log('failed to load patch');
        throw e;
      }
    } else {
      // No data to load, create default setup
      this.rootClosure = createRootUserClosure();
      this.rootDefinition = this.rootClosure.definition;

      defExtra.set(this.rootDefinition, new DefExtra({viewOffset: {x: 0, y: 0}}));
    }

    this.rootActivation = this.rootClosure.activate();
    this.rootActivation.evaluate();

    this.setState({
      creatingNode: null,
      appExtra: new IMap(appExtra),
      defExtra: new IMap(defExtra),
      selectedPort: null,
    });
  }

  elemRelativePosition(elem) {
    let x = 0, y = 0;

    while (elem !== this.rootElem) {
      x += elem.offsetLeft;
      // SUPER HACK: This class has transform: translateY(-50%) which we need to account for
      if (elem.classList.contains('Patcher_definition-ports')) {
        y += elem.offsetTop - 0.5*elem.offsetHeight;
      } else {
        y += elem.offsetTop;
      }
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

  flashMessage(message) {
    this.flashMessageElem.flash(message);
  }

  handleCopy = (event) => {
    if (event.target === document.body) {
      this.flashMessage('Copy Patch');

      const data = this.serialize();
      event.clipboardData.setData('text/plain', data);
      event.clipboardData.setData('application/json', data);
      event.preventDefault();
    }
  }

  handlePaste = (event) => {
    if (event.target === document.body) {

      const data = event.clipboardData.getData('text/plain');
      if (data) {
        this.load(data);
        this.flashMessage('Paste Patch');
      } else {
        this.flashMessage('Paste Patch - No Data');
      }
      event.preventDefault();
    }
  }

  handleDefinitionMouseDown = (definition, event) => {
    if (event.target === event.currentTarget) {
      this.beginDrag(event, {
        kind: 'definition',
        definition,
      });
      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleNodeHeaderMouseDown = (app, event) => {
    if (event.target === event.currentTarget) {
      this.beginDrag(event, {
        kind: 'nodemove',
        app,
      });
      event.preventDefault();
      event.stopPropagation();
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
    } else if (this.drag.target.kind === 'nodemove') {
      const app = this.drag.target.app;
      this.setState((state) => ({...state, appExtra: state.appExtra.updateIn([app, 'position'], p => ({x: p.x + dx, y: p.y + dy}))}));
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

  handleCreateNodeBoxSelect = (defName, def) => {
    if (!this.state.creatingNode) {
      throw new Error('internal error');
    }

    // Look up what definition this creation is happening within
    const containingDefinition = this.state.creatingNode.definition;

    // If the definition has function parameters, created sub-definitions for each one
    const functionArguments = new Map();
    if (def.functionParameters) {
      for (const n in def.functionParameters) {
        const signature = def.functionParameters[n];
        const subdef = containingDefinition.addContainedUserDefinition(signature);
        this.setState(state => ({...state, defExtra: state.defExtra.set(subdef, new DefExtra({viewOffset: {x: 0, y: 0}}))}));
        functionArguments.set(n, subdef);
      }
    }

    const app = containingDefinition.addNativeApplication(def, functionArguments);

    this.setState((state) => {
      const boxPos = state.creatingNode.boxPosition;
      const offset = this.elemRelativePosition(this.defPositioningElemMap.get(containingDefinition));
      const position = {
        x: boxPos.x - offset.x,
        y: boxPos.y - offset.y,
      };

      const appExtra = new AppExtra({
        uid: genUID(),
        position,
        defName,
        def,
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

        if (a.portObj === b.portObj) {
          // Clear selected port
          return {...state, selectedPort: null};
        }

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

        const def = a.portObj.containingDefinition;

        if (!invalid) {
          if (!def.isValidConnection(a.portObj, b.portObj)) {
            invalid = true;
          }
        }

        if (invalid) {
          this.flashMessage('Invalid Connection');
          return state; // ignore
        } else {
          def.addConnection(a.portObj, b.portObj);

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
    portObj.containingDefinition.disconnectPort(portObj);
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

  serialize() {
    class ObjectNumberer {
      constructor() {
        this.map = new Map();
        this.nextNum = 1;
      }

      getNumber(obj) {
        if (!this.map.has(obj)) {
          this.map.set(obj, this.nextNum++);
        }
        return this.map.get(obj);
      }
    }

    const appNumberer = new ObjectNumberer();
    const defNumberer = new ObjectNumberer();

    const serializeDefinition = (def) => {
      const defNum = defNumberer.getNumber(def);

      const apps = [];
      for (const napp of def.nativeApplications) {
        const extra = this.state.appExtra.get(napp);

        const appObj = {
          i: appNumberer.getNumber(napp),
          d: extra.defName,
          p: extra.position,
        };

        if (extra.functionArguments.size) {
          const funcArgs = {};
          for (const [n, d] of extra.functionArguments) {
            funcArgs[n] = defNumberer.getNumber(d);
          }

          appObj.fa = funcArgs;
        }

        if (napp.settings !== undefined) {
          appObj.s = napp.settings;
        }

        apps.push(appObj);
      }

      const subdefs = [...def.containedDefinitions].map(subdef => serializeDefinition(subdef));

      const cxns = [];
      for (const cxn of def.connections) {
        const portReference = (port) => {
          const owner = port.owner;
          switch (owner.tag) {
            case 'app':
              return {
                t: 'a',
                a: appNumberer.getNumber(owner.app),
                ...(owner.which === undefined ? {} : {w: owner.which}),
              };

            case 'def':
              return {
                t: 'd',
                ...(owner.which === undefined ? {} : {w: owner.which}),
              };

            default:
              throw new Error('internal error');
          }
        };

        const cxnObj = {
          o: portReference(cxn.outPort),
          i: portReference(cxn.inPort),
        }

        if (cxn.path.length) {
          cxnObj.i.d = defNumberer.getNumber(cxn.inPort.containingDefinition);
        }

        cxns.push(cxnObj);
      }

      const defObj = {
        i: defNum,
        a: apps,
        c: cxns,
      };

      if (subdefs.length) {
        defObj.sd = subdefs;
      }

      const TEMPO_SHORTFORM = new Map([['step', 's'], ['event', 'e']]);
      const serializePortSig = (ps) => ({
        t: TEMPO_SHORTFORM.get(ps.tempo),
        ...(ps.name ? {n: ps.name} : {}),
      });

      if (def.definitionInputs.length) {
        defObj.di = def.definitionInputs.map(di => serializePortSig(di));
      }

      if (def.definitionOutput instanceof Map) {
        defObj.dos = {};
        for (const [n, p] of def.definitionOutput) {
          defObj.dos[n] = serializePortSig(p);
        }
      } else if (def.definitionOutput) {
        defObj.do = serializePortSig(def.definitionOutput);
      }

      return defObj;
    };

    const obj = {
      r3v: 1,
      d: serializeDefinition(this.rootDefinition),
    };

    return JSON.stringify(obj);
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

      const dx = fromPos.x - toPos.x;
      const dy = fromPos.y - toPos.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      // Place cp1 right of fromPos, cp2 left of toPos
      const MAX_STRAIN_RELIEF = 100;
      const strainRelief = Math.min(0.5*dist, MAX_STRAIN_RELIEF);
      const cp1x = fromPos.x + strainRelief;
      const cp2x = toPos.x - strainRelief;
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.bezierCurveTo(cp1x, fromPos.y, cp2x, toPos.y, toPos.x, toPos.y);
    }
    ctx.stroke();
  }

  renderPort(name, portObj, key, isInput) {
    const sp = this.state.selectedPort;
    const selected = sp && (sp.portObj === portObj);

    return (
      <div key={key} onClick={() => { this.handlePortClick(portObj, isInput); }} onDoubleClick={() => { this.handlePortDoubleClick(portObj); }} ref={el => { this.portElemMap.set(portObj, el); }} className={'Patcher_node-port' + (selected ? ' Patcher_node-port-selected' : '')}>{name || '\u00a0'}</div>
    );
  }

  renderApplication(napp, definition) {
    const appExtra = this.state.appExtra.get(napp);

    const inputPorts = [];
    const outputPorts = [];
    for (let i = 0; i < napp.inputs.length; i++) {
      const p = napp.inputs[i];
      inputPorts.push({name: p.name, portObj: p, key: i.toString()});
    }
    if (napp.output instanceof Map) {
      for (const [n, p] of napp.output) {
        outputPorts.push({name: n, portObj: p, key: n});
      }
    } else if (napp.output) {
      outputPorts.push({name: napp.output.name, portObj: napp.output, key: ''});
    }

    return (
      <div key={appExtra.uid} className="Patcher_node Patcher_box-shadow" style={{position: 'absolute', left: appExtra.position.x, top: appExtra.position.y}}>
        <div className="Patcher_node-header" onMouseDown={(e) => { this.handleNodeHeaderMouseDown(napp, e); }}>{appExtra.defName}<div className="Patcher_node-header-buttons"><button onClick={() => { this.handleRemoveNode(appExtra.uid); }}>✕</button></div></div>
        {appExtra.def.ui &&
          <ApplicationSettings uiClass={appExtra.def.ui} initialSettings={napp.settings} onChangeSettings={(newSettings) => { definition.setApplicationSettings(napp, newSettings); }} />
        }
        <div className="Patcher_node-ports">
          <div className="Patcher_input-ports-block">{inputPorts.map(p => this.renderPort(p.name, p.portObj, p.key, true))}</div>
          <div className="Patcher_output-ports-block">{outputPorts.map(p => this.renderPort(p.name, p.portObj, p.key, false))}</div>
        </div>
        {(appExtra.functionArguments.size > 0) &&
          <div className="Patcher_node-inline-defs">
            {[...appExtra.functionArguments.entries()].map(([n, subdef]) => (
              <div className="Patcher_node-inline-def" key={n} style={{width: 400, height: 300}}>
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
          {[...definition.nativeApplications].map(napp => this.renderApplication(napp, definition))}
        </div>
        {(definition.definitionInputs.length > 0) &&
          <div className="Patcher_definition-ports Patcher_definition-input-ports Patcher_box-shadow">
            <div className="Patcher_output-ports-block">
              {definition.definitionInputs.map((outPort, i) => this.renderPort(outPort.name, outPort, i.toString(), false))}
            </div>
          </div>
        }
        {definition.definitionOutput &&
          <div className="Patcher_definition-ports Patcher_definition-output-ports Patcher_box-shadow">
            <div className="Patcher_input-ports-block">{(() => {
              if (definition.definitionOutput instanceof Map) {
                return [...definition.definitionOutput].map(([n, inPort]) => this.renderPort(n, inPort, n, true));
              } else if (definition.definitionOutput) {
                return this.renderPort(null, definition.definitionOutput, '', true);
              }
            })()}</div>
          </div>
        }
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
        <FlashMessage ref={(el) => { this.flashMessageElem = el; }} />
      </div>
    );
  }
}

export default Patcher;
