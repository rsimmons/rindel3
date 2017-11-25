import UserDefinition from './src/UserDefinition';

// Create a new (initially empty) user-defined function definition at the root level (not contained within another definition)
export function createRootUserDefinition() {
  return new UserDefinition(null, null);
}
