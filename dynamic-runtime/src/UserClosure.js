export default class UserClosure {
  constructor(userDefinition, containingActivation) {
    this.userDefinition = userDefinition;
    this.containingActivation = containingActivation;
  }

  activate(onOutputChange, functionArguments) {
    return this.userDefinition.activateWithContainingActivation(this.containingActivation, onOutputChange, functionArguments);
  }

  get definition() {
    return this.userDefinition;
  }
}
