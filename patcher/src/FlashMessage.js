import React, { Component } from 'react';
import './FlashMessage.css';

export default class FlashMessage extends Component {
  flash(s) {
    this.elem.textContent = s;

    this.elem.classList.remove('FlashMessage_fade-out');
    setTimeout(() => {
      this.elem.classList.add('FlashMessage_fade-out');
    }, 0);
  }

  render() {
    return <div className="FlashMessage FlashMessage_fade-out" ref={(el) => { this.elem = el; }} />;
  }
}
