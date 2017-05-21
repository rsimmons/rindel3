import Patcher from './Patcher';
import testPrograms from './testPrograms';

const patcher = new Patcher();

const programListElem = document.getElementById('program-list');

const startProgram = (program) => {
  // Clear any previous patch
  patcher.clear();

  program.run(patcher);
}

for (const prog of testPrograms) {
  const anchorElem = document.createElement('a');
  anchorElem.textContent = prog.name;
  anchorElem.setAttribute('href', '#');
  (() => {
    anchorElem.addEventListener('click', (e) => {
      e.preventDefault();
      startProgram(prog);
    });
  })();

  const itemElem = document.createElement('li');
  itemElem.appendChild(anchorElem);

  programListElem.appendChild(itemElem);
}

startProgram(testPrograms[0]);
