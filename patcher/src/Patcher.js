import React, { Component } from 'react';
import CreateNodeBox from './CreateNodeBox';
import './Patcher.css';
import NodePool from './NodePool';

class Patcher extends Component {
  constructor(props) {
    super(props);

    // Positions in state are relative to patcher element
    this.state = {
      mouseDownPos: null,
      createNodeBoxPos: null,
    };

    this.nodePool = new NodePool(); // TODO: this should probably be passed as a prop, but let's load directly for now

    this.mouseCaptured = false;
    this.rootElem = null;

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleCreateNodeBoxSelect = this.handleCreateNodeBoxSelect.bind(this);
    this.handleCreateNodeBoxCancel = this.handleCreateNodeBoxCancel.bind(this);
  }

  componentWillUnmount() {
    if (this.mouseCaptured) {
      this.releaseMouse();
    }
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
          // If no box is shown, show it at the click position
          this.setState({
            createNodeBoxPos: pos,
          });
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

  handleCreateNodeBoxSelect(n) {
    // TODO: instantiate node
    this.closeCreateNodeBox();
  }

  handleCreateNodeBoxCancel() {
    this.closeCreateNodeBox();
  }

  render() {
    return (
      <div className="Patcher" ref={(el) => { this.rootElem = el; }} onMouseDown={this.handleMouseDown} onMouseUp={this.handleMouseUp}>
        {this.state.createNodeBoxPos &&
          <div style={{position: 'absolute', left: this.state.createNodeBoxPos.x, top: this.state.createNodeBoxPos.y}}><CreateNodeBox width={200} nodePool={this.nodePool} onSelect={this.handleCreateNodeBoxSelect} onCancel={this.handleCreateNodeBoxCancel} /></div>
        }
      </div>
    );
  }
}

export default Patcher;
