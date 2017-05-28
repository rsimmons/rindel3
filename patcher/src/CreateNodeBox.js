import React, { Component } from 'react';
import './CreateNodeBox.css';

class CreateNodeBox extends Component {
  constructor(props) {
    super(props);

    this.inputElem = null;

    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  componentDidMount() {
    this.inputElem.focus();
  }

  handleKeyDown(e) {
    switch (e.key) {
      case 'Escape':
        this.props.onClose();
        break;

      case 'Enter':
        break;

      case 'ArrowDown':
        break;

      case 'ArrowUp':
        break;

      default:
        break;
    }
  }

  render() {
    const {width} = this.props;

    return (
      <div className="CreateNodeBox" style={{width}} onKeyDown={this.handleKeyDown}>
        <input type="text" ref={(el) => { this.inputElem = el; }} />
        <ul>
          <li>foo</li>
          <li>bar</li>
          <li>baz</li>
          <li>quux</li>
        </ul>
      </div>
    );
  }
}

export default CreateNodeBox;
