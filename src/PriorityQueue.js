import FastPriorityQueue from 'fastpriorityqueue';

export default class PriorityQueue {
  constructor() {
    this.fpq = new FastPriorityQueue((a, b) => (a.priority - b.priority));
  }

  isEmpty() {
    return this.fpq.isEmpty();
  }

  // task is expected to have "priority" property that is a string
  insert(priority, data) {
    this.fpq.add({priority, data});
  }

  pop() {
    return this.fpq.poll().data;
  }

  peek() {
    return this.fpq.peek().data;
  }

  clear() {
    while (!this.fpq.isEmpty()) {
      this.fpq.poll();
    }
  }
}
