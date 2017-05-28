import React, { Component } from 'react';
import CreateNodeBox from './CreateNodeBox';
import './Patcher.css';

class Patcher extends Component {
  constructor(props) {
    super(props);

    // Positions in state are relative to patcher element
    this.state = {
      mouseDownPos: null,
      createNodeBoxPos: null,
    };

    this.mouseCaptured = false;
    this.rootElem = null;

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleCreateNodeBoxClose = this.handleCreateNodeBoxClose.bind(this);
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

  handleCreateNodeBoxClose() {
    this.closeCreateNodeBox();
  }

  render() {
    return (
      <div className="Patcher" ref={(el) => { this.rootElem = el; }} onMouseDown={this.handleMouseDown} onMouseUp={this.handleMouseUp}>
        {this.state.createNodeBoxPos &&
          <div style={{position: 'absolute', left: this.state.createNodeBoxPos.x, top: this.state.createNodeBoxPos.y}}><CreateNodeBox width={200} onClose={this.handleCreateNodeBoxClose} /></div>
        }
      </div>
    );
  }
}

export default Patcher;
