// lastChangedInstant behaves slightly different depending on whether the stream is
// step or event tempo:
// For step streams, lastChangedInstant is the time of the last change. If there has
// never been a change (the value has always been undefined), then lastChangedInstant
// may be set or may be undefined.
// For event streams, lastChangedInstant is the time of the last event on the stream.
// If there has never been an event, then lastChangedInstant should be undefined.
// Events that are older than the current instant are not visible to function implementations.
export default class Stream {
  constructor(initialValue, initialInstant) {
    this.latestValue = initialValue;
    this.lastChangedInstant = initialInstant;
  }

  setValue(newValue, instant) {
    this.latestValue = newValue;
    this.lastChangedInstant = instant;
  }
}
