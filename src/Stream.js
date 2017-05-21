export default class Stream {
  constructor() {
    this.latestValue = undefined;
    this.lastChangedInstant = undefined;
  }

  setValue(newValue, instant) {
    this.latestValue = newValue;
    this.lastChangedInstant = instant;
  }

  copyFrom(otherStream) {
    this.latestValue = otherStream.latestValue;
    this.lastChangedInstant = otherStream.lastChangedInstant;
  }
}
