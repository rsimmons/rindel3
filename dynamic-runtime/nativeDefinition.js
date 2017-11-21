import assert from './assert';

// NOTE: This is factored out into a separate function because in the future,
// it is expected that native definitions may have different 'styles' rather
// than following the same "standard" calling conventions, and so to activate
// them will be more work.
export function activateNativeDefinition(definition, initialInputs, onOutputChange, functionArguments) {
  return definition.activate(initialInputs, onOutputChange, functionArguments);
}
