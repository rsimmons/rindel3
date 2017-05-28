import React, { Component } from 'react';
import './CreateNodeBox.css';

class CreateNodeBox extends Component {
  constructor(props) {
    super(props);

    this.state = {
      query: '',
    };

    this.inputElem = null;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
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

  handleInputChange(e) {
    this.setState({query: e.target.value});
  }

  render() {
    const {width, nodePool} = this.props;
    const results = nodePool.search(this.state.query);

    return (
      <div className="CreateNodeBox" style={{width}} onKeyDown={this.handleKeyDown}>
        <input type="text" ref={(el) => { this.inputElem = el; }} onChange={this.handleInputChange} />
        <ul>
          {results.map((r) =>
            <li key={r.node.id} dangerouslySetInnerHTML={{__html: r.formattedStr}} />
          )}
        </ul>
      </div>
    );
  }
}

export default CreateNodeBox;
