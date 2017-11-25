export default function assert(v) {
  if (!v) {
    throw new Error('assertion failed');
  }
}
