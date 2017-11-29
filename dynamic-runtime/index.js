import UserDefinition from './src/UserDefinition';
import UserClosure from './src/UserClosure';
import * as nativeDefinitionHelpers from './src/nativeDefinitionHelpers';

// Create a closure of an empty user-defined function definition at the root level (not contained within another definition)
export function createRootUserClosure(signature) {
  return new UserClosure(new UserDefinition(null, signature), null);
}

export { nativeDefinitionHelpers };
