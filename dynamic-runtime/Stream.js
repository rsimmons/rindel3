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
