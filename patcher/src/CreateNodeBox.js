import React, { Component } from 'react';
import './CreateNodeBox.css';

class CreateNodeBox extends Component {
  constructor(props) {
    super(props);

    this.inputElem = null;
  }

  componentDidMount() {
    this.inputElem.focus();
  }

  render() {
    const {width} = this.props;

    return (
      <div className="CreateNodeBox" style={{width}}>
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
